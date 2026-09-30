/**
 * Composition root KCG Code (task 20) — wiring server.
 *
 * `createKcgServer()` merakit seluruh komponen dan menjalankan
 * `Bun.serve({ hostname, port, routes, websocket })`. Mengikuti struktur
 * kcgcode: handler HTTP dikelompokkan per fitur di `routes/*.routes.ts`
 * (di-assemble di sini) dan domain logic di `services/`.
 * - Routes HTTP `/api/projects`, `/api/fs`, `/api/sessions`, upload lampiran,
 *   `/api/skills` (tabel rute terpisah) + upgrade WebSocket di `/ws`.
 * - Kunci aplikasi opsional (lock screen, `services/auth.ts`): bila diatur,
 *   seluruh `/api/*` & `/ws` mewajibkan cookie sesi. Tanpa kunci, server
 *   hanya aman karena bind ke `127.0.0.1` secara default (lihat `host.ts`).
 * - `reconcileOnStartup()` dipanggil sebelum `Bun.serve` menerima koneksi
 *   (Requirement 2.4).
 *
 * Dipisah dari `src/index.ts` (entry) agar dapat diuji (task 20.2) dengan
 * injeksi `config`, `store`, dan `spawn` mock — tanpa mengimpor HTML.
 */

import path from "node:path";
import { type HTMLBundle, type Server, type ServerWebSocket, serve } from "bun";
import { type AppConfig, loadConfig } from "../config";
import { openSessionStore, type SessionStore } from "../db";
import { PUBLIC_DIR, resolveEffectiveUploadsDir, resolveFrpcConfigPath } from "../paths";
import { resolveHostname } from "./host";
import { authRoutes } from "./routes/auth.routes";
import { guardRoutes, originAllowed, readSessionToken } from "./routes/auth-guard";
import { projectsRoutes } from "./routes/projects.routes";
import { sessionsRoutes } from "./routes/sessions.routes";
import { skillsRoutes } from "./routes/skills.routes";
import { tunnelRoutes } from "./routes/tunnel.routes";
import type { ApiRouteContext } from "./routes/types";
import { uploadsRoutes } from "./routes/uploads.routes";
import { type AttachmentManager, createAttachmentManager } from "./services/attachments";
import { type AuthService, createAuthService } from "./services/auth";
import { createFrpcInstaller } from "./services/frpc-installer";
import {
  createOpenCodeServerManager,
  type OpenCodeServerManager,
} from "./services/opencode-server";
import { createProjectManager, type ProjectManager } from "./services/project-manager";
import { createSessionManager, type SessionManager } from "./services/session-manager";
import { createSkillInstallJobs } from "./services/skill-install-jobs";
import {
  createSkillsRegistry,
  isValidSkillId,
  isValidSource,
  type SkillsRegistry,
} from "./services/skills-registry";
import { createTunnelManager, type TunnelManager } from "./services/tunnel";
import { createTunnelApi } from "./services/tunnel-api";
import { resolveTunnelConfig } from "./services/tunnel-config";
import { createLhrManager, type LhrManager } from "./services/tunnel-lhr";
import {
  createWebSocketGateway,
  type Subscriber,
  type WebSocketGateway,
} from "./services/websocket-gateway";
import { bunWsSubscriber, dispatchClientMessage } from "./services/ws-transport";

/**
 * Data per-koneksi WebSocket: id sesi login pemiliknya (null = kunci belum
 * diatur saat koneksi dibuka). Dipakai untuk menutup socket saat sesi itu
 * dicabut / terkunci.
 */
type WsData = { authSessionId: string | null };

export interface KcgServerOptions {
  config?: AppConfig;
  store?: SessionStore;
  /** Injeksi OpenCode_Server_Manager (untuk pengujian, task 20.2). */
  servers?: OpenCodeServerManager;
  /** Injeksi Skills_Registry (skills.sh + CLI `skills`) untuk pengujian. */
  skillsRegistry?: SkillsRegistry;
  /** Injeksi Auth_Service (mis. hash cepat untuk test). */
  auth?: AuthService;
  /**
   * Factory Tunnel_Manager (test menyuntik API/spawn palsu). Menerima
   * dependensi yang hanya diketahui composition root.
   */
  tunnel?: (deps: {
    store: SessionStore;
    auth: AuthService;
    port: number;
    hostname: string;
  }) => TunnelManager;
  /** Factory tunnel localhost.run (test menyuntik spawn palsu). */
  lhr?: (deps: {
    store: SessionStore;
    auth: AuthService;
    port: number;
    hostname: string;
  }) => LhrManager;
  /** Direktori lampiran gambar upload (default: `~/.kcgcode/data/uploads`). */
  uploadsRoot?: string;
  hostname?: string;
  port?: number;
  /** Shell SPA untuk rute halaman terdaftar (`spaPaths`; default: 404). */
  spa?: Response | HTMLBundle;
  /**
   * Rute halaman yang menyajikan shell SPA — didaftarkan eksplisit di entry
   * (`src/index.ts`) persis seperti daftar rute SPA kcgcode; path lain 404.
   */
  spaPaths?: string[];
}

export interface KcgServer {
  server: Server<WsData>;
  store: SessionStore;
  projectManager: ProjectManager;
  sessionManager: SessionManager;
  gateway: WebSocketGateway;
  /** Job instalasi skill (diekspos untuk pengujian). */
  skillInstalls: ApiRouteContext["skillInstalls"];
  /** Kunci aplikasi (diekspos untuk pengujian & CLI). */
  auth: AuthService;
  /** Tunnel publik (diekspos untuk dashboard terminal & pengujian). */
  tunnel: TunnelManager;
  /** Pola rute `/api/*` yang terdaftar (untuk test cakupan penjaga). */
  apiRoutePatterns: string[];
  /** Shutdown: simpan status running (budget 5s) -> stop server -> tutup store. */
  close(): Promise<void>;
}

/**
 * Port HTTP default 3000 (env KCG_PORT). Nilai tak valid ditolak agar
 * `Bun.serve` tidak menerima NaN dari `Number(env)`.
 */
function resolvePort(): number {
  const raw = process.env.KCG_PORT;
  if (raw === undefined) return 3000;
  const n = Number(raw);
  if (Number.isInteger(n) && n > 0 && n <= 65535) return n;
  console.warn(`[kcg-code] KCG_PORT tidak valid ("${raw}"); memakai 3000.`);
  return 3000;
}

async function staticFile(filePath: string, contentType: string): Promise<Response> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) return new Response("Not Found", { status: 404 });
  return new Response(file, { headers: { "content-type": contentType } });
}

/**
 * Membangun seluruh komponen KCG Code, me-reconcile status Session, dan
 * menjalankan `Bun.serve`. `reconcileOnStartup()` dieksekusi sebelum server
 * menerima koneksi (Requirement 2.4).
 */
export function createKcgServer(opts: KcgServerOptions = {}): KcgServer {
  const config = opts.config ?? loadConfig();
  const store = opts.store ?? openSessionStore();
  const hostname = opts.hostname ?? resolveHostname();
  const port = opts.port ?? resolvePort();
  // Direktori lampiran gambar. Absolut sejak awal agar URL `file:///…`
  // valid. Default sesuai mode runtime (dev: ./data/uploads, cli: ~/.kcgcode/...).
  const uploadsRoot = opts.uploadsRoot ?? resolveEffectiveUploadsDir();

  const projectManager = createProjectManager(config.sandboxRoot, store);
  const servers = opts.servers ?? createOpenCodeServerManager();
  const attachments: AttachmentManager = createAttachmentManager(uploadsRoot);

  // Skills_Registry & job instalasi dibuat lebih dulu: session manager
  // memberi tahu job instalasi saat refresh skill tertunda selesai. Callback
  // `refreshSkills` baru dipanggil saat instalasi berjalan (setelah init).
  const skillsRegistry = opts.skillsRegistry ?? createSkillsRegistry();
  const skillInstalls = createSkillInstallJobs({
    registry: skillsRegistry,
    refreshSkills: (projectId) => sessionManager.refreshSkills(projectId),
    validate: (source, skill) => isValidSource(source) && isValidSkillId(skill),
  });

  let gateway: WebSocketGateway;
  const sessionManager = createSessionManager({
    store,
    servers,
    attachments,
    onMessage: (message) => gateway.notifyMessage(message.sessionId, message),
    onMessagePart: (sessionId, messageId, part) =>
      gateway.notifyMessagePart(sessionId, messageId, part),
    onMessagePartDelta: (sessionId, messageId, partId, field, delta) =>
      gateway.notifyMessagePartDelta(sessionId, messageId, partId, field, delta),
    onPrompt: (prompt) => gateway.notifyPrompt(prompt.sessionId, prompt),
    // Kartu kembar yang ikut terjawab lewat fan-out grup: kirim notif
    // `prompt_resolved` agar hilang dari UI tanpa menunggu reattach.
    onPromptResolved: (sessionId, promptId) => gateway.notifyPromptResolved(sessionId, promptId),
    onStatusChange: (sessionId, status) => gateway.notifySessionStatus(sessionId, status),
    // Judul hasil generate opencode -> daftar Session di Client terbarui live.
    onTitleChange: (sessionId, title) => gateway.notifySessionTitle(sessionId, title),
    onDeleted: (sessionId) => gateway.notifySessionDeleted(sessionId),
    onError: (sessionId, message) => gateway.notifyError(sessionId, "AGENT_ERROR", message),
    // Turn mulai/selesai -> Client tahu kapan model merespon (tombol stop).
    onTurnChange: (sessionId, active) => gateway.notifyTurnActive(sessionId, active),
    // Refresh skill tertunda berjalan otomatis setelah chat selesai -> perbarui
    // notifikasi instalasi terkait ("aktif sekarang").
    onSkillsRefreshed: (projectId) => skillInstalls.markRefreshed(projectId),
  });
  gateway = createWebSocketGateway({ store, sessionManager });

  // Requirement 2.4: tandai Session "running" tanpa proses sebelum menerima koneksi.
  sessionManager.reconcileOnStartup();

  // Subscriber per koneksi (identitas stabil untuk Map gateway).
  const wsSubs = new Map<ServerWebSocket<WsData>, Subscriber>();

  // ---- Kunci aplikasi (lock screen) ----
  const auth = opts.auth ?? createAuthService({ store });

  // ---- Tunnel publik (<username>.<domain dari VPS>) — wajib app lock ----
  const tunnel = opts.tunnel
    ? opts.tunnel({ store, auth, port, hostname })
    : (() => {
        const tcfg = resolveTunnelConfig();
        return createTunnelManager({
          store,
          config: tcfg,
          // Tanpa URL API: klien yang selalu gagal (connect() sudah menolak lebih dulu).
          api: createTunnelApi(tcfg.apiUrl ?? "http://tunnel-api.invalid"),
          installer: createFrpcInstaller(),
          localPort: port,
          localHost: hostname,
          configPath: resolveFrpcConfigPath(),
          isProtected: () => auth.isProtected(),
        });
      })();
  // ---- Tunnel localhost.run (gratis, via ssh) — wajib app lock ----
  const lhr = opts.lhr
    ? opts.lhr({ store, auth, port, hostname })
    : createLhrManager({
        store,
        localPort: port,
        localHost: hostname,
        dataDir: path.dirname(resolveFrpcConfigPath()),
        isProtected: () => auth.isProtected(),
      });
  auth.onLockChanged((prot) => {
    tunnel.handleLockChanged(prot);
    lhr.handleLockChanged(prot);
  });

  // Konteks bersama untuk tabel rute API.
  const routeCtx: ApiRouteContext = {
    projectManager,
    sessionManager,
    attachments,
    skillsRegistry,
    skillInstalls,
    tunnel,
    lhr,
    tunnelProvider: () => store.getTunnelSettings(Date.now()).provider,
    setTunnelProvider: (provider) => store.setTunnelProvider(provider, Date.now()),
    notifyDataChanged: () => gateway.notifyDataChanged(),
  };
  // Sesi dicabut / terkunci / kedaluwarsa -> tutup WebSocket miliknya agar
  // perangkat itu tidak terus menerima data percakapan.
  auth.onSessionEnded((sessionId) => {
    for (const ws of wsSubs.keys()) {
      if (ws.data.authSessionId === sessionId) ws.close(4401, "locked");
    }
  });
  /** Kunci baru diatur -> tutup socket yang dibuka tanpa sesi (sebelum dikunci). */
  function closeUnauthenticatedSockets(): void {
    if (!auth.isProtected()) return;
    for (const ws of wsSubs.keys()) {
      if (ws.data.authSessionId === null) ws.close(4401, "locked");
    }
  }
  // Kunci otomatis ditegakkan server: sapu sesi idle/kedaluwarsa berkala.
  const sweepTimer = setInterval(() => {
    try {
      auth.sweep();
      closeUnauthenticatedSockets();
    } catch (e) {
      console.error("[kcg-code] auth sweep gagal:", e);
    }
  }, 30_000);
  sweepTimer.unref?.();

  const apiRoutes = guardRoutes(auth, {
    ...authRoutes(auth),
    ...projectsRoutes(routeCtx),
    ...sessionsRoutes(routeCtx),
    ...uploadsRoutes(routeCtx),
    ...skillsRoutes(routeCtx),
    ...tunnelRoutes(routeCtx),
  });

  const server = serve<WsData>({
    hostname,
    port,
    routes: {
      // ---- Asset statis PWA dari root paket (bukan cwd) — aman utk global install ----
      "/manifest.json": () =>
        staticFile(path.join(PUBLIC_DIR, "manifest.json"), "application/manifest+json"),
      "/sw.js": () => staticFile(path.join(PUBLIC_DIR, "sw.js"), "text/javascript"),
      "/logo.svg": () => staticFile(path.join(PUBLIC_DIR, "logo.svg"), "image/svg+xml"),

      // ---- Rute API per fitur (pola kcgcode: tabel rute terpisah) ----
      // Seluruh `/api/*` dijaga kunci aplikasi (kecuali status/login/avatar).
      ...apiRoutes,

      // ---- WebSocket_Gateway upgrade (Requirement 4) ----
      // WebSocket tidak dibatasi CORS, jadi Origin wajib same-origin dan
      // sesi login wajib valid sebelum upgrade.
      "/ws": (req: Request, server: Server<WsData>) => {
        if (!originAllowed(req)) return new Response("Forbidden", { status: 403 });
        let authSessionId: string | null = null;
        if (auth.isProtected()) {
          const session = auth.authenticate(readSessionToken(req));
          if (!session) return new Response("Unauthorized", { status: 401 });
          authSessionId = session.id;
        }
        const upgraded = server.upgrade(req, { data: { authSessionId } });
        if (!upgraded) return new Response("Upgrade WebSocket gagal", { status: 400 });
        return undefined;
      },

      // ---- Shell SPA hanya untuk rute halaman terdaftar (disuntik entry,
      //      default 404) — path tak dikenal tidak menangkap shell SPA ----
      ...Object.fromEntries(
        (opts.spaPaths ?? []).map((pattern) => [
          pattern,
          opts.spa ?? new Response("Not Found", { status: 404 }),
        ]),
      ),
    },
    websocket: {
      data: { authSessionId: null } as WsData,
      open(ws) {
        wsSubs.set(ws, bunWsSubscriber(ws));
      },
      message(ws, message) {
        // Socket yang tak terdaftar (sudah ditutup) diabaikan.
        const sub = wsSubs.get(ws);
        if (!sub) return;
        // Setiap pesan dianggap aktivitas: sesi tetap hidup selama dipakai,
        // dan socket milik sesi yang sudah terkunci ditutup.
        if (auth.isProtected()) {
          const alive =
            ws.data.authSessionId !== null && auth.isSessionAlive(ws.data.authSessionId);
          if (!alive) {
            ws.close(4401, "locked");
            return;
          }
        }
        dispatchClientMessage(gateway, sub, String(message));
      },
      close(ws) {
        const sub = wsSubs.get(ws);
        if (sub) {
          gateway.detach(sub);
          wsSubs.delete(ws);
        }
      },
    },
    development: process.env.NODE_ENV !== "production" && {
      hmr: true,
      console: true,
    },
  });

  // Tunnel yang aktif sebelum restart dinyalakan lagi setelah server listen.
  // Port nyata diketahui setelah `serve` (port 0 di test) — factory default
  // memakai `port` yang diminta, sama seperti yang dicetak dashboard.
  // Hanya penyedia terpilih yang dinyalakan ulang (satu tunnel aktif).
  if (store.getTunnelSettings(Date.now()).provider === "lhr") lhr.autoStart();
  else tunnel.autoStart();

  async function close(): Promise<void> {
    clearInterval(sweepTimer);
    // Hentikan frpc lebih dulu agar URL publik tidak menunjuk server mati.
    await Promise.all([tunnel.shutdown(), lhr.shutdown()]);
    // Hentikan instalasi skill yang berjalan agar proses CLI tidak yatim.
    await skillInstalls.cancelAll();
    // shutdown() menyimpan status running (budget 5s) lalu menghentikan server headless.
    await sessionManager.shutdown();
    await server.stop(true);
    store.close();
  }

  return {
    server,
    store,
    projectManager,
    sessionManager,
    gateway,
    skillInstalls,
    auth,
    tunnel,
    apiRoutePatterns: Object.keys(apiRoutes),
    close,
  };
}
