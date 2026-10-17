/**
 * Server proxy Preview: listener terpisah dari app utama yang meneruskan
 * seluruh request (HTTP + WebSocket untuk HMR) ke dev server sebuah Project.
 *
 * Kenapa listener & origin sendiri (bukan `/preview/<port>/` di app utama):
 * app yang di-preview memakai path absolut (`/assets/…`, `/@vite/client`,
 * `/_next/…`) dan HMR WebSocket ke root — di bawah prefix path semuanya
 * rusak. Di origin sendiri app merasa berjalan di root.
 *
 * Lewat tunnel KCG origin ini adalah `https://<user>--preview.<domain>` (satu
 * proxy frpc statis). Lokal: `http://<host>:<previewPort>`.
 *
 * Auth: app utama (sudah dijaga kunci aplikasi) menerbitkan tiket sekali
 * pakai (60 detik) -> `GET /__kcg/preview/auth?t=` menukarnya dengan cookie
 * host-only. Cookie tidak pernah di-set di parent domain karena subdomain
 * tetangga milik pengguna lain. Setiap request mengecek ulang sesi app utama
 * (di-cache sebentar) sehingga logout / cabut perangkat ikut menutup preview.
 *
 * Halaman HTML diberi overlay (`overlay-api.ts`): tombol melayang untuk
 * reload, kembali ke chat, kirim pesan ke agent, dan error console.
 */

import { randomBytes } from "node:crypto";
import type { Server, ServerWebSocket } from "bun";
import type { DevServerStatus } from "../../../types";
import type { DevServerManager } from "./dev-servers";
import {
  createOverlayApi,
  injectOverlay,
  OVERLAY_PREFIX,
  OVERLAY_SCRIPT_PATH,
  type PreviewBridge,
  wantsDocument,
} from "./overlay-api";
import type { Screenshotter, Viewport } from "./screenshot";

export const PREVIEW_AUTH_PATH = "/__kcg/preview/auth";
export const PREVIEW_COOKIE = "__kcg_preview";

const TICKET_TTL_MS = 60_000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const RECHECK_MS = 15_000;

/** Header hop-by-hop yang tidak boleh diteruskan proxy. */
const HOP_BY_HOP = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

/** Asal preview: Project, Session chat yang membukanya, origin app utama. */
export interface PreviewTarget {
  projectId: string;
  sessionId: string | null;
  appOrigin: string | null;
}

interface Ticket extends PreviewTarget {
  mainToken: string | null;
  expiresAt: number;
}

interface PreviewSession extends Ticket {
  checkedAt: number;
}

interface WsData {
  projectId: string;
  target: string;
  protocols: string[];
  headers: Record<string, string>;
  upstream: WebSocket | null;
  queue: Array<string | ArrayBuffer>;
}

export interface PreviewServerOptions {
  hostname: string;
  /** Port yang diminta; bila terpakai, pakai port acak. */
  port: number;
  devServers: DevServerManager;
  /** Sesi app utama masih sah (dipanggil ulang tiap `RECHECK_MS`). */
  isAuthorized: (mainToken: string | null) => boolean;
  /** Jembatan ke Session untuk overlay (null = overlay tanpa chat). */
  bridge?: PreviewBridge | null;
  /** Chrome headless untuk screenshot dari overlay (null = tidak tersedia). */
  screenshotter?: Screenshotter | null;
  now?: () => number;
}

/** Halaman & viewport terakhir yang dibuka di preview sebuah Project. */
export interface PreviewView {
  path: string;
  viewport: Partial<Viewport> | null;
}

export interface PreviewServer {
  /** Port nyata listener preview. */
  readonly port: number;
  /** Tiket sekali pakai untuk membuka preview Project (dari request yang sudah login). */
  issueTicket(target: PreviewTarget, mainToken: string | null): string;
  /** Halaman & viewport terakhir yang dilihat di preview Project (untuk snapshot). */
  lastView(projectId: string): PreviewView;
  /** Status dev server berubah -> overlay yang terbuka ikut tahu. */
  serverChanged(projectId: string, server: DevServerStatus | null): void;
  stop(): Promise<void>;
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx !== -1 && part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return null;
}

/** Header Cookie tanpa cookie milik kcgcode (tidak bocor ke dev server). */
function stripOwnCookie(header: string | null): string | null {
  if (!header) return null;
  const kept = header
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p !== "" && !p.startsWith(`${PREVIEW_COOKIE}=`));
  return kept.length > 0 ? kept.join("; ") : null;
}

function isHttps(req: Request): boolean {
  if (new URL(req.url).protocol === "https:") return true;
  return req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https";
}

/** Origin publik preview sebagaimana dilihat browser. */
function publicOrigin(req: Request): string {
  const host = req.headers.get("host") ?? new URL(req.url).host;
  return `${isHttps(req) ? "https" : "http"}://${host}`;
}

function page(
  status: number,
  title: string,
  body: string,
  opts: { refresh?: boolean; overlay?: boolean } = {},
): Response {
  const refresh = opts.refresh ?? false;
  const html = `<!doctype html><html lang="en"><head>${opts.overlay ? `<script src="${OVERLAY_SCRIPT_PATH}" data-kcg-preview></script>` : ""}<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${refresh ? '<meta http-equiv="refresh" content="2">' : ""}
<meta name="color-scheme" content="dark light"><title>${title} · KCG Code</title>
<style>body{margin:0;min-height:100svh;display:grid;place-items:center;font:15px/1.5 system-ui,sans-serif;padding:24px;box-sizing:border-box}
main{max-width:22rem;text-align:center}h1{font-size:18px;font-weight:600;margin:0 0 8px}p{margin:0;opacity:.7}</style>
</head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

/**
 * Tolak request yang dipicu situs lain. Subdomain tunnel pengguna lain
 * (`bob.<domain>`) dihitung *same-site* dengan origin preview, jadi cookie
 * SameSite tetap terkirim — yang lolos hanya request dari origin preview
 * sendiri dan navigasi top-level (mis. link "Open preview" dari app utama).
 */
export function crossSiteBlocked(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (
    (site === "same-site" || site === "cross-site") &&
    req.headers.get("sec-fetch-mode") !== "navigate"
  ) {
    return true;
  }
  // Browser tanpa Fetch Metadata: Origin wajib cocok untuk upgrade &
  // request yang mengubah state.
  const origin = req.headers.get("origin");
  const unsafe =
    req.headers.get("upgrade")?.toLowerCase() === "websocket" ||
    !["GET", "HEAD", "OPTIONS"].includes(req.method);
  if (!origin || !unsafe) return false;
  try {
    return new URL(origin).host !== (req.headers.get("host") ?? new URL(req.url).host);
  } catch {
    return true;
  }
}

function upstreamUrl(up: { host: string; port: number }, path: string, ws = false): string {
  const host = up.host.includes(":") ? `[${up.host}]` : up.host;
  return `${ws ? "ws" : "http"}://${host}:${up.port}${path}`;
}

/**
 * Header request ke dev server: dibuat seolah dari browser lokal. Host lolos
 * `allowedHosts` Vite; Origin cocok dengan Host sehingga cek CSRF dev server
 * (Bun, Next server actions) tidak menolak. Asal request yang sebenarnya
 * sudah dicek `crossSiteBlocked`. URL absolut balik ditulis ulang di respons.
 */
function forwardHeaders(req: Request, port: number): Headers {
  const h = new Headers(req.headers);
  for (const k of HOP_BY_HOP) h.delete(k);
  for (const k of ["x-forwarded-host", "x-forwarded-proto", "x-forwarded-port"]) h.delete(k);
  const cookie = stripOwnCookie(req.headers.get("cookie"));
  if (cookie) h.set("cookie", cookie);
  else h.delete("cookie");
  h.set("host", `localhost:${port}`);
  if (h.has("origin")) h.set("origin", `http://localhost:${port}`);
  return h;
}

/** Location absolut ke dev server lokal -> origin preview. */
function rewriteLocation(loc: string, port: number, origin: string): string {
  const m = loc.match(/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):(\d+)(\/.*)?$/i);
  if (m && Number(m[1]) === port) return `${origin}${m[2] ?? "/"}`;
  return loc;
}

/** `Domain=localhost` membuat cookie dev server ditolak browser di origin preview. */
function stripCookieDomain(cookie: string): string {
  return cookie
    .split(";")
    .filter((p) => !/^\s*domain\s*=/i.test(p))
    .join(";");
}

function responseHeaders(res: Response, port: number, origin: string): Headers {
  const h = new Headers();
  res.headers.forEach((v, k) => {
    const key = k.toLowerCase();
    if (HOP_BY_HOP.includes(key) || key === "set-cookie") return;
    h.set(k, key === "location" ? rewriteLocation(v, port, origin) : v);
  });
  for (const c of res.headers.getSetCookie()) h.append("set-cookie", stripCookieDomain(c));
  return h;
}

function safeCloseCode(code: number): number {
  // 1005/1006/1015 hanya boleh dilaporkan, tidak boleh dikirim.
  return code === 1000 ||
    (code >= 3000 && code <= 4999) ||
    (code >= 1001 && code <= 1014 && code !== 1005 && code !== 1006)
    ? code
    : 1011;
}

export function createPreviewServer(opts: PreviewServerOptions): PreviewServer {
  const now = opts.now ?? Date.now;
  const tickets = new Map<string, Ticket>();
  const sessions = new Map<string, PreviewSession>();
  const views = new Map<string, PreviewView>();
  function view(projectId: string): PreviewView {
    let v = views.get(projectId);
    if (!v) {
      v = { path: "/", viewport: null };
      views.set(projectId, v);
    }
    return v;
  }
  const overlay = createOverlayApi({
    bridge: opts.bridge ?? null,
    serverStatus: (projectId) => opts.devServers.status(projectId),
    upstream: (projectId) => opts.devServers.upstream(projectId),
    screenshotter: opts.screenshotter ?? null,
    onViewport: (projectId, viewport) => {
      view(projectId).viewport = viewport;
    },
  });

  function prune(): void {
    const t = now();
    for (const [k, v] of tickets) if (v.expiresAt <= t) tickets.delete(k);
    for (const [k, v] of sessions) if (v.expiresAt <= t) sessions.delete(k);
  }

  function sessionOf(req: Request): PreviewSession | null {
    const id = readCookie(req, PREVIEW_COOKIE);
    if (!id) return null;
    const s = sessions.get(id);
    if (!s) return null;
    const t = now();
    if (s.expiresAt <= t) {
      sessions.delete(id);
      return null;
    }
    if (t - s.checkedAt >= RECHECK_MS) {
      if (!opts.isAuthorized(s.mainToken)) {
        sessions.delete(id);
        return null;
      }
      s.checkedAt = t;
    }
    return s;
  }

  function handleAuth(req: Request): Response {
    prune();
    const url = new URL(req.url);
    const ticket = tickets.get(url.searchParams.get("t") ?? "");
    if (!ticket) {
      return page(401, "Preview link expired", "Open the preview again from KCG Code.");
    }
    tickets.delete(url.searchParams.get("t") ?? "");
    const id = randomBytes(32).toString("base64url");
    sessions.set(id, {
      ...ticket,
      expiresAt: now() + SESSION_TTL_MS,
      checkedAt: now(),
    });
    const attrs = [
      `${PREVIEW_COOKIE}=${id}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    ];
    if (isHttps(req)) attrs.push("Secure");
    return new Response(null, {
      status: 302,
      headers: { location: "/", "set-cookie": attrs.join("; "), "cache-control": "no-store" },
    });
  }

  async function handle(req: Request, server: Server<WsData>): Promise<Response | undefined> {
    const url = new URL(req.url);
    if (url.pathname === PREVIEW_AUTH_PATH) return handleAuth(req);

    if (crossSiteBlocked(req)) return new Response("Forbidden", { status: 403 });
    const session = sessionOf(req);
    if (!session) {
      return page(401, "Preview locked", "Open the preview from KCG Code to sign in.");
    }
    if (url.pathname.startsWith(OVERLAY_PREFIX)) {
      // SSE overlay hidup lama: jangan diputus idle timeout Bun (10 dtk).
      server.timeout(req, 0);
      const res = await overlay.handle(req, session);
      if (res) return res;
    }
    opts.devServers.touch(session.projectId);
    const status = opts.devServers.status(session.projectId);
    const up = opts.devServers.upstream(session.projectId);
    if (!up) {
      if (status?.phase === "starting") {
        return page(503, "Dev server is starting…", "This page reloads on its own.", {
          refresh: true,
          overlay: true,
        });
      }
      return page(503, "Dev server isn't running", "Start it from KCG Code.", { overlay: true });
    }

    const path = url.pathname + url.search;
    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const protocols = (req.headers.get("sec-websocket-protocol") ?? "")
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      const headers: Record<string, string> = { host: `localhost:${up.port}` };
      const cookie = stripOwnCookie(req.headers.get("cookie"));
      if (cookie) headers.cookie = cookie;
      // Sama seperti `forwardHeaders`: dev server menolak upgrade bila
      // Origin != Host.
      if (req.headers.has("origin")) headers.origin = `http://localhost:${up.port}`;
      const ok = server.upgrade(req, {
        data: {
          projectId: session.projectId,
          target: upstreamUrl(up, path, true),
          protocols,
          headers,
          upstream: null,
          queue: [],
        },
        headers: protocols[0] ? { "Sec-WebSocket-Protocol": protocols[0] } : undefined,
      });
      return ok ? undefined : new Response("Upgrade failed", { status: 400 });
    }

    try {
      const document = wantsDocument(req);
      if (document) view(session.projectId).path = path;
      const headers = forwardHeaders(req, up.port);
      // Dokumen HTML perlu dibaca untuk menyisipkan overlay: minta tanpa kompresi.
      if (document) headers.set("accept-encoding", "identity");
      const res = await fetch(upstreamUrl(up, path), {
        method: req.method,
        headers,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
        redirect: "manual",
        decompress: false,
      });
      const outHeaders = responseHeaders(res, up.port, publicOrigin(req));
      const html =
        document &&
        res.status === 200 &&
        (res.headers.get("content-type") ?? "").includes("text/html") &&
        !res.headers.get("content-encoding");
      if (html) {
        outHeaders.delete("content-length");
        return new Response(injectOverlay(await res.text()), {
          status: res.status,
          statusText: res.statusText,
          headers: outHeaders,
        });
      }
      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: outHeaders,
      });
    } catch {
      return page(502, "Dev server isn't responding", "Check the dev server logs in KCG Code.", {
        overlay: true,
      });
    }
  }

  const websocket = {
    open(ws: ServerWebSocket<WsData>) {
      const d = ws.data;
      let up: WebSocket;
      try {
        // Konstruktor Bun menerima header (tipe DOM tidak mengenalnya).
        const BunWebSocket = WebSocket as unknown as new (
          url: string,
          options: Bun.WebSocketOptions,
        ) => WebSocket;
        up = new BunWebSocket(d.target, { headers: d.headers, protocols: d.protocols });
      } catch {
        ws.close(1011, "upstream unavailable");
        return;
      }
      up.binaryType = "arraybuffer";
      d.upstream = up;
      // HMR tersambung = preview sedang dibuka (menunda idle stop).
      opts.devServers.connectionOpened(d.projectId);
      up.onopen = () => {
        for (const m of d.queue) up.send(m);
        d.queue = [];
      };
      up.onmessage = (ev) => {
        ws.send(ev.data as string | ArrayBuffer);
      };
      up.onclose = (ev) => {
        ws.close(safeCloseCode(ev.code), ev.reason);
      };
      up.onerror = () => {
        ws.close(1011, "upstream error");
      };
    },
    message(ws: ServerWebSocket<WsData>, message: string | Buffer) {
      const d = ws.data;
      const msg =
        typeof message === "string"
          ? message
          : (message.buffer.slice(
              message.byteOffset,
              message.byteOffset + message.byteLength,
            ) as ArrayBuffer);
      if (d.upstream?.readyState === WebSocket.OPEN) d.upstream.send(msg);
      else d.queue.push(msg);
    },
    close(ws: ServerWebSocket<WsData>, code: number, reason: string) {
      const up = ws.data.upstream;
      if (up) opts.devServers.connectionClosed(ws.data.projectId);
      if (up && (up.readyState === WebSocket.OPEN || up.readyState === WebSocket.CONNECTING)) {
        up.close(safeCloseCode(code), reason);
      }
    },
  };

  const serveOpts = (port: number) => ({
    hostname: opts.hostname,
    port,
    reusePort: false,
    fetch: handle,
    websocket,
  });
  let server: Server<WsData>;
  try {
    server = Bun.serve<WsData>(serveOpts(opts.port));
  } catch {
    server = Bun.serve<WsData>(serveOpts(0));
  }

  return {
    get port() {
      return server.port ?? 0;
    },
    issueTicket(target, mainToken) {
      prune();
      const t = randomBytes(24).toString("base64url");
      tickets.set(t, { ...target, mainToken, expiresAt: now() + TICKET_TTL_MS });
      return t;
    },
    serverChanged: overlay.serverChanged,
    lastView: (projectId) => ({ ...view(projectId) }),
    async stop() {
      await Promise.race([server.stop(true), Bun.sleep(2000)]);
    },
  };
}
