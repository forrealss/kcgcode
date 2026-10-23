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
 * Bagian perakitan ada di `./bootstrap/`: kontrak publik (`types`), inti
 * Session + gateway (`session-core`), kunci aplikasi & tunnel (`access`),
 * koneksi WebSocket (`ws-connections`), tabel rute API (`api-routes`), asset
 * statis & shell SPA (`static-routes`), dan urutan shutdown (`shutdown`).
 *
 * Dipisah dari `src/index.ts` (entry) agar dapat diuji (task 20.2) dengan
 * injeksi `config`, `store`, dan `spawn` mock — tanpa mengimpor HTML.
 */

import { serve } from "bun";
import { DEFAULT_PORT, loadConfig, parsePort } from "../config";
import { openSessionStore } from "../db";
import { resolveEffectiveUploadsDir } from "../paths";
import { autoStartSelectedTunnel, createAccess } from "./bootstrap/access";
import { createApiRoutes } from "./bootstrap/api-routes";
import { createPreviewWiring } from "./bootstrap/preview";
import { createSessionCore } from "./bootstrap/session-core";
import { createShutdown } from "./bootstrap/shutdown";
import { publicAssetRoutes, spaRoutes } from "./bootstrap/static-routes";
import type { KcgServer, KcgServerOptions } from "./bootstrap/types";
import { createWsConnections, startAuthSweep, type WsData } from "./bootstrap/ws-connections";
import { resolveHostname } from "./host";
import { AGENT_MCP_PATH } from "./services/preview/agent-mcp";
import { createUpdateChecker } from "./services/update-check";

export type { KcgServer, KcgServerOptions } from "./bootstrap/types";

/**
 * Port HTTP bila `opts.port` kosong (`bun dev`): `KCG_PORT` > `port` di config
 * > 3000 — prioritas yang sama dengan CLI (`cli/port.ts`). `KCG_PORT` tak
 * valid diabaikan agar `Bun.serve` tidak menerima NaN dari `Number(env)`.
 */
function resolvePort(configPort: number | undefined): number {
  const fallback = configPort ?? DEFAULT_PORT;
  const raw = process.env.KCG_PORT;
  if (raw === undefined) return fallback;
  const port = parsePort(raw);
  if (port !== null) return port;
  console.warn(`[kcg-code] KCG_PORT tidak valid ("${raw}"); memakai ${fallback}.`);
  return fallback;
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
  const port = opts.port ?? resolvePort(config.port);
  // Direktori lampiran gambar. Absolut sejak awal agar URL `file:///…`
  // valid. Default sesuai mode runtime (dev: ./data/uploads, cli: ~/.kcgcode/...).
  const uploadsRoot = opts.uploadsRoot ?? resolveEffectiveUploadsDir();

  // Preview: opsi session-core dulu, dev server & listener setelah core siap.
  const previewWiring = createPreviewWiring({ store, hostname, port });

  // Termasuk `reconcileOnStartup()` (Requirement 2.4).
  const core = createSessionCore({
    ...previewWiring.coreOptions,
    store,
    sandboxRoot: config.sandboxRoot,
    uploadsRoot,
    opencode: opts.opencode,
    claude: opts.claude,
    skillsRegistry: opts.skillsRegistry,
    pushFetch: opts.pushFetch,
  });
  // frpc membaca port listener Preview saat tunnel dinyalakan (setelah listen).
  const access = createAccess({
    store,
    port,
    hostname,
    previewPort: previewWiring.previewPort,
    auth: opts.auth,
    tunnel: opts.tunnel,
    lhr: opts.lhr,
  });
  const { auth } = access;
  const { devServers, preview, agentMcp, screenshotter, snapshots } = previewWiring.start({
    core,
    auth,
  });
  const ws = createWsConnections({ auth, gateway: core.gateway });
  const sweepTimer = startAuthSweep(auth, ws);

  // Cek versi baru di npm di background — tidak menahan server mulai.
  const updates = opts.updates ?? createUpdateChecker();
  void updates.start();

  const apiRoutes = createApiRoutes({
    config,
    store,
    uploadsRoot,
    core,
    access,
    updates,
    devServers,
    preview,
    screenshotter,
    snapshots,
  });

  const server = serve<WsData>({
    hostname,
    port,
    routes: {
      // ---- Chunk frontend prebuilt (bila ada); rute eksplisit di bawah menang ----
      ...opts.assets,

      // ---- Asset statis PWA dari root paket (bukan cwd) — aman utk global install ----
      ...publicAssetRoutes(),

      // ---- Rute API per fitur (pola kcgcode: tabel rute terpisah) ----
      // Seluruh `/api/*` dijaga kunci aplikasi (kecuali status/login/avatar).
      ...apiRoutes,

      // ---- WebSocket_Gateway upgrade (Requirement 4) ----
      "/ws": ws.upgrade,

      // ---- MCP `kcg_preview` untuk proses agent (token Bearer per Project) ----
      [AGENT_MCP_PATH]: (req: Request) => agentMcp.handle(req),

      // ---- Shell SPA hanya untuk rute halaman terdaftar (disuntik entry,
      //      default 404) — path tak dikenal tidak menangkap shell SPA ----
      ...spaRoutes(opts.spaPaths, opts.spa),
    },
    websocket: ws.handlers,
    development: process.env.NODE_ENV !== "production" && {
      hmr: true,
      console: true,
    },
  });

  // Nyalakan ulang tunnel terpilih setelah server listen.
  // Port nyata (0 di test) untuk URL MCP yang diberikan ke proses agent.
  previewWiring.setListenPort(server.port ?? port);

  autoStartSelectedTunnel(store, access);

  return {
    server,
    store,
    projectManager: core.projectManager,
    sessionManager: core.sessionManager,
    gateway: core.gateway,
    skillInstalls: core.skillInstalls,
    auth,
    tunnel: access.tunnel,
    lhr: access.lhr,
    notifications: core.notifications,
    updates,
    tunnelProvider: () => store.getTunnelSettings(Date.now()).provider,
    apiRoutePatterns: Object.keys(apiRoutes),
    previewPort: preview.port,
    close: createShutdown({
      sweepTimer,
      core,
      access,
      updates,
      server,
      store,
      devServers,
      preview,
      screenshotter,
    }),
  };
}
