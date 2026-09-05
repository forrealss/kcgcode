/**
 * Composition root KCG Code (task 20) — wiring server.
 *
 * `createKcgServer()` merakit seluruh komponen dan menjalankan
 * `Bun.serve({ hostname, port, routes, websocket })`. Mengikuti struktur
 * kcgcode: handler HTTP dikelompokkan per fitur di `routes/*.routes.ts`
 * (di-assemble di sini), otentikasi di `middleware/auth.middleware.ts`,
 * dan domain logic di `services/`.
 * - Routes HTTP `/api/projects`, `/api/fs`, `/api/sessions`, upload lampiran
 *   (tabel rute terpisah) + upgrade WebSocket di `/ws`.
 * - `auth.middleware.ts` dipasang di setiap route API dan upgrade WS
 *   (Req 9.2, 9.3); asset statis PWA (manifest/sw/logo) dan shell HTML
 *   dibiarkan publik agar aplikasi dapat dimuat — kontrol CLI_Agent hanya
 *   lewat `/api/*` dan `/ws`.
 * - `reconcileOnStartup()` dipanggil sebelum `Bun.serve` menerima koneksi
 *   (Requirement 2.4).
 *
 * Dipisah dari `src/index.ts` (entry) agar dapat diuji (task 20.2) dengan
 * injeksi `config`, `auth`, `store`, dan `spawn` mock — tanpa mengimpor HTML.
 */

import path from "node:path";
import { type HTMLBundle, type Server, type ServerWebSocket, serve } from "bun";
import { type AppConfig, loadConfig } from "../config";
import { openSessionStore, type SessionStore } from "../db";
import {
  type AuthConfig,
  createApiGuard,
  loadAuthConfig,
  WS_AUTH_CLOSE_CODE,
} from "./middleware/auth.middleware";
import { projectsRoutes } from "./routes/projects.routes";
import { sessionsRoutes } from "./routes/sessions.routes";
import type { ApiRouteContext } from "./routes/types";
import { uploadsRoutes } from "./routes/uploads.routes";
import { type AttachmentManager, createAttachmentManager } from "./services/attachments";
import {
  createOpenCodeServerManager,
  type OpenCodeServerManager,
} from "./services/opencode-server";
import { createProjectManager, type ProjectManager } from "./services/project-manager";
import { createSessionManager, type SessionManager } from "./services/session-manager";
import {
  bunWsSubscriber,
  createWebSocketGateway,
  dispatchClientMessage,
  type Subscriber,
  type WebSocketGateway,
} from "./services/websocket-gateway";

/** Data per-koneksi WebSocket (hasil otentikasi upgrade, Req 9.3). */
interface WsData {
  authed: boolean;
}

export interface KcgServerOptions {
  config?: AppConfig;
  auth?: AuthConfig;
  store?: SessionStore;
  /** Injeksi OpenCode_Server_Manager (untuk pengujian, task 20.2). */
  servers?: OpenCodeServerManager;
  /** Direktori lampiran gambar upload (default: `data/uploads`). */
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
  const auth = opts.auth ?? loadAuthConfig();
  const store = opts.store ?? openSessionStore();
  const hostname = opts.hostname ?? auth.hostname;
  const port = opts.port ?? resolvePort();
  // Direktori lampiran gambar. Absolut sejak awal (path.resolve) agar URL
  // `file:///…` yang dikirim ke opencode valid — URL relatif (host tidak
  // kosong) ditolak opencode dan prompt gagal diam-diam.
  const uploadsRoot = opts.uploadsRoot ?? path.resolve("data/uploads");

  const projectManager = createProjectManager(config.sandboxRoot, store);
  const servers = opts.servers ?? createOpenCodeServerManager();
  const attachments: AttachmentManager = createAttachmentManager(uploadsRoot);

  let gateway: WebSocketGateway;
  const sessionManager = createSessionManager({
    store,
    servers,
    attachments,
    onMessage: (message) => gateway.notifyMessage(message.sessionId, message),
    onMessagePart: (sessionId, messageId, part) =>
      gateway.notifyMessagePart(sessionId, messageId, part),
    onPrompt: (prompt) => gateway.notifyPrompt(prompt.sessionId, prompt),
    // Kartu kembar yang ikut terjawab lewat fan-out grup: kirim notif
    // `prompt_resolved` agar hilang dari UI tanpa menunggu reattach.
    onPromptResolved: (sessionId, promptId) => gateway.notifyPromptResolved(sessionId, promptId),
    onStatusChange: (sessionId, status) => gateway.notifySessionStatus(sessionId, status),
    onDeleted: (sessionId) => gateway.notifySessionDeleted(sessionId),
    onError: (sessionId, message) => gateway.notifyError(sessionId, "AGENT_ERROR", message),
    // Turn mulai/selesai -> Client tahu kapan model merespon (tombol stop).
    onTurnChange: (sessionId, active) => gateway.notifyTurnActive(sessionId, active),
  });
  gateway = createWebSocketGateway({ store, sessionManager });

  // Requirement 2.4: tandai Session "running" tanpa proses sebelum menerima koneksi.
  sessionManager.reconcileOnStartup();

  // Middleware auth + konteks bersama untuk tabel rute API.
  const { authOk, guard } = createApiGuard(auth);
  const routeCtx: ApiRouteContext = { projectManager, sessionManager, attachments, guard };

  // Subscriber per koneksi (identitas stabil untuk Map gateway).
  const wsSubs = new Map<ServerWebSocket<WsData>, Subscriber>();

  const server = serve<WsData>({
    hostname,
    port,
    routes: {
      // ---- Asset statis PWA (Requirement 8.1) ----
      "/manifest.json": () => staticFile("public/manifest.json", "application/manifest+json"),
      "/sw.js": () => staticFile("public/sw.js", "text/javascript"),
      "/logo.svg": () => staticFile("public/logo.svg", "image/svg+xml"),

      // ---- Rute API per fitur (pola kcgcode: tabel rute terpisah) ----
      ...projectsRoutes(routeCtx),
      ...sessionsRoutes(routeCtx),
      ...uploadsRoutes(routeCtx),

      // ---- WebSocket_Gateway upgrade (Requirement 4, 9.3) ----
      "/ws": (req: Request, server: Server<WsData>) => {
        const upgraded = server.upgrade(req, { data: { authed: authOk(req) } });
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
      data: {} as WsData,
      open(ws) {
        wsSubs.set(ws, bunWsSubscriber(ws));
        // Requirement 9.3: upgrade tanpa kredensial valid -> tutup dgn close code 4401.
        if (!ws.data.authed) {
          ws.close(WS_AUTH_CLOSE_CODE, "Unauthorized");
        }
      },
      message(ws, message) {
        // Socket yang tak terdaftar (auth gagal / sudah ditutup) diabaikan.
        const sub = wsSubs.get(ws);
        if (!sub) return;
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

  async function close(): Promise<void> {
    // shutdown() menyimpan status running (budget 5s) lalu menghentikan server headless.
    await sessionManager.shutdown();
    await server.stop(true);
    store.close();
  }

  return { server, store, projectManager, sessionManager, gateway, close };
}
