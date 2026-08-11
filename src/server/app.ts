/**
 * Wiring server utama KCG Bridge (task 20).
 *
 * `createKcgServer()` merakit seluruh komponen dan menjalankan
 * `Bun.serve({ hostname, port, routes, websocket })`:
 * - Routes HTTP `/api/projects` (GET/POST), `/api/fs` (GET, Folder_Browser),
 *   `/api/sessions` (GET/POST/DELETE) + upgrade WebSocket di `/ws`.
 * - `auth.ts` dipasang di setiap route API dan upgrade WS (Req 9.2, 9.3);
 *   asset statis PWA (manifest/sw/logo) dan shell HTML dibiarkan publik agar
 *   aplikasi dapat dimuat — kontrol CLI_Agent hanya lewat `/api/*` dan `/ws`.
 * - `reconcileOnStartup()` dipanggil sebelum `Bun.serve` menerima koneksi
 *   (Requirement 2.4).
 *
 * Dipisah dari `src/index.ts` (entry) agar dapat diuji (task 20.2) dengan
 * injeksi `config`, `auth`, `store`, dan `spawn` mock — tanpa mengimpor HTML.
 */
import { type BunRequest, type HTMLBundle, type Server, type ServerWebSocket, serve } from "bun";
import {
  type AuthConfig,
  isAuthorized,
  loadAuthConfig,
  unauthorizedResponse,
  WS_AUTH_CLOSE_CODE,
} from "./auth";
import { type AppConfig, loadConfig } from "./config";
import { openSessionStore, type SessionStore } from "./db";
import { createOpenCodeServerManager, type OpenCodeServerManager } from "./opencode-server";
import { createProjectManager, type ProjectManager } from "./project-manager";
import { createSessionManager, type SessionManager } from "./session-manager";
import type { AgentType } from "./types";
import {
  bunWsSubscriber,
  createWebSocketGateway,
  dispatchClientMessage,
  type Subscriber,
  type WebSocketGateway,
} from "./websocket-gateway";

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
  hostname?: string;
  port?: number;
  /** Shell SPA untuk rute tak dikenal (default: 404). */
  spa?: Response | HTMLBundle;
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

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function serverError(err: unknown): Response {
  console.error("[kcg-bridge] error tidak terduga:", err);
  return json({ error: "INTERNAL_ERROR" }, 500);
}

/**
 * Pemetaan error domain ke status HTTP (design.md — Error Handling):
 * 400 validasi, 404 tidak ditemukan, 409 konflik, sisanya 500.
 */
function errorStatus(code: string): number {
  switch (code) {
    case "NAME_REQUIRED":
    case "PATH_OUTSIDE_SANDBOX":
    case "INVALID_PATH_CHARS":
    case "UNSUPPORTED_AGENT_TYPE":
    case "INVALID_SIZE":
      return 400;
    case "PROJECT_NOT_FOUND":
    case "PROJECT_DIR_NOT_FOUND":
    case "SESSION_NOT_FOUND":
    case "PATH_NOT_FOUND":
      return 404;
    case "NAME_TAKEN":
    case "PATH_TAKEN":
    case "SESSION_NOT_RUNNING":
    case "SESSION_NOT_ACTIVE":
      return 409;
    default:
      return 500;
  }
}

/**
 * Membaca body JSON; body tidak valid -> `{ ok: false }` sehingga handler
 * dapat membalas 400 (bukan 500 dari `serverError`).
 */
async function readJson(req: Request): Promise<{ ok: true; data: unknown } | { ok: false }> {
  try {
    return { ok: true, data: await req.json() };
  } catch {
    return { ok: false };
  }
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
  console.warn(`[kcg-bridge] KCG_PORT tidak valid ("${raw}"); memakai 3000.`);
  return 3000;
}

async function staticFile(filePath: string, contentType: string): Promise<Response> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) return new Response("Not Found", { status: 404 });
  return new Response(file, { headers: { "content-type": contentType } });
}

/**
 * Membangun seluruh komponen KCG Bridge, me-reconcile status Session, dan
 * menjalankan `Bun.serve`. `reconcileOnStartup()` dieksekusi sebelum server
 * menerima koneksi (Requirement 2.4).
 */
export function createKcgServer(opts: KcgServerOptions = {}): KcgServer {
  const config = opts.config ?? loadConfig();
  const auth = opts.auth ?? loadAuthConfig();
  const store = opts.store ?? openSessionStore();
  const hostname = opts.hostname ?? auth.hostname;
  const port = opts.port ?? resolvePort();

  const projectManager = createProjectManager(config.sandboxRoot, store);
  const servers = opts.servers ?? createOpenCodeServerManager();

  let gateway: WebSocketGateway;
  const sessionManager = createSessionManager({
    store,
    servers,
    onMessage: (message) => gateway.notifyMessage(message.sessionId, message),
    onMessagePart: (sessionId, messageId, part) =>
      gateway.notifyMessagePart(sessionId, messageId, part),
    onPrompt: (prompt) => gateway.notifyPrompt(prompt.sessionId, prompt),
    onStatusChange: (sessionId, status) => gateway.notifySessionStatus(sessionId, status),
    onError: (sessionId, message) => gateway.notifyError(sessionId, "AGENT_ERROR", message),
  });
  gateway = createWebSocketGateway({ store, sessionManager });

  // Requirement 2.4: tandai Session "running" tanpa proses sebelum menerima koneksi.
  sessionManager.reconcileOnStartup();

  // Subscriber per koneksi (identitas stabil untuk Map gateway).
  const wsSubs = new Map<ServerWebSocket<WsData>, Subscriber>();

  function authOk(req: Request): boolean {
    const url = new URL(req.url);
    return isAuthorized(auth, {
      authHeader: req.headers.get("authorization"),
      queryToken: url.searchParams.get("token"),
    });
  }

  function guard<Req extends Request, Res extends Response>(
    handler: (req: Req) => Res | Promise<Res>,
  ): (req: Req) => Response | Promise<Response> {
    return (req) => {
      if (!authOk(req)) return unauthorizedResponse();
      return handler(req);
    };
  }

  const server = serve<WsData>({
    hostname,
    port,
    routes: {
      // ---- Asset statis PWA (Requirement 8.1) ----
      "/manifest.json": () => staticFile("public/manifest.json", "application/manifest+json"),
      "/sw.js": () => staticFile("public/sw.js", "text/javascript"),
      "/logo.svg": () => staticFile("public/logo.svg", "image/svg+xml"),

      // ---- Project & Folder_Browser (Requirement 10) ----
      "/api/projects": {
        GET: guard(() => {
          try {
            return json({ projects: projectManager.listProjects() });
          } catch (e) {
            return serverError(e);
          }
        }),
        POST: guard(async (req) => {
          try {
            const body = await readJson(req);
            if (!body.ok) return json({ error: "INVALID_JSON" }, 400);
            const { name, path } = body.data as { name?: unknown; path?: unknown };
            const res = projectManager.createProject(
              typeof name === "string" ? name : "",
              typeof path === "string" ? path : "",
            );
            if (!res.ok) return json({ error: res.error }, errorStatus(res.error));
            return json({ project: res.data }, 201);
          } catch (e) {
            return serverError(e);
          }
        }),
      },

      "/api/fs": {
        GET: guard((req) => {
          try {
            const url = new URL(req.url);
            const res = projectManager.listDirectory(url.searchParams.get("path") ?? "");
            if (!res.ok) return json({ error: res.error }, errorStatus(res.error));
            return json({ entries: res.data.entries });
          } catch (e) {
            return serverError(e);
          }
        }),
      },

      // ---- Session (Requirement 1, 4) ----
      "/api/sessions": {
        GET: guard(() => {
          try {
            return json({ sessions: sessionManager.listSessions() });
          } catch (e) {
            return serverError(e);
          }
        }),
        POST: guard(async (req) => {
          try {
            const body = await readJson(req);
            if (!body.ok) return json({ error: "INVALID_JSON" }, 400);
            const { agentType, projectId } = body.data as {
              agentType?: unknown;
              projectId?: unknown;
            };
            const res = await sessionManager.createSession({
              agentType: (typeof agentType === "string" ? agentType : "") as AgentType,
              projectId: typeof projectId === "string" ? projectId : "",
            });
            if (!res.ok) return json({ error: res.error }, errorStatus(res.error));
            return json({ session: res.session }, 201);
          } catch (e) {
            return serverError(e);
          }
        }),
      },

      "/api/sessions/:id": {
        DELETE: guard((req: BunRequest<"/api/sessions/:id">) => {
          try {
            const res = sessionManager.stopSession(req.params.id);
            if (!res.ok) {
              return json({ error: res.error ?? "ERROR" }, errorStatus(res.error ?? ""));
            }
            return json({ ok: true });
          } catch (e) {
            return serverError(e);
          }
        }),
      },

      // ---- WebSocket_Gateway upgrade (Requirement 4, 9.3) ----
      "/ws": (req: Request, server: Server<WsData>) => {
        const upgraded = server.upgrade(req, { data: { authed: authOk(req) } });
        if (!upgraded) return new Response("Upgrade WebSocket gagal", { status: 400 });
        return undefined;
      },

      // ---- Shell SPA untuk rute lain (disuntik dari entry, default 404) ----
      "/*": opts.spa ?? new Response("Not Found", { status: 404 }),
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
