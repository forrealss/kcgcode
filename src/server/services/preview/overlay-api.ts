/**
 * Overlay Preview: script yang disuntik ke halaman app yang di-preview
 * (tombol melayang + sheet) beserta API kecilnya di origin preview.
 *
 * Semua di bawah `/__kcg/preview/` — path yang tidak akan dipakai app.
 * - `overlay.js`        script overlay (dibundel dari `overlay/index.ts`)
 * - `api/state`         Session terkait, status agent & dev server, URL chat
 * - `api/events`        SSE: turn agent, balasan terakhir, butuh jawaban, dev server
 * - `api/prompt`        kirim pesan ke Session (POST `{ text, images? }`)
 * - `api/screenshot`    JPEG halaman saat ini dari Chrome headless (POST
 *                       `{ path, width, height, dpr }`) untuk dianotasi
 * - `api/upload`        simpan gambar (hasil anotasi/foto) sebagai lampiran
 *                       Session -> `{ id }` untuk `images` di prompt
 * - `api/draft`         simpan draf composer bersama (POST `{ draft, origin }`);
 *                       draf ikut di `api/state` & disiarkan lewat `api/events`
 * - `api/attachment/:id` gambar lampiran Session (mis. diunggah dari app) agar
 *                       bisa tampil di draf overlay
 *
 * Overlay menjadi subscriber gateway WebSocket yang sama dengan chat, jadi
 * status & pengiriman pesan memakai jalur yang persis sama.
 */

import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { isPreviewableImage } from "../../../lib/attachments";
import {
  type ComposerDraft,
  type DevServerStatus,
  DRAFT_LIMITS,
  EMPTY_DRAFT,
  type SessionStatus,
} from "../../../types";
import type { ServerMessage } from "../../../ws-protocol";
import type { Result } from "../../result";
import { isValidOrigin, parseDraft } from "../drafts";
import type { Subscriber } from "../gateway/types";
import type { Screenshotter, Viewport } from "./screenshot";

export const OVERLAY_PREFIX = "/__kcg/preview/";
export const OVERLAY_SCRIPT_PATH = `${OVERLAY_PREFIX}overlay.js`;
const API_PREFIX = `${OVERLAY_PREFIX}api/`;

const MAX_PROMPT_LENGTH = 20_000;
const REPLY_SNIPPET = 600;
const KEEPALIVE_MS = 20_000;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

export interface PreviewSessionInfo {
  id: string;
  title: string | null;
  status: SessionStatus;
  turnActive: boolean;
}

/** Jembatan ke Session KCG Code (dirakit composition root). */
export interface PreviewBridge {
  /** Session milik Project ini, atau null. */
  session(projectId: string, sessionId: string): PreviewSessionInfo | null;
  sendPrompt(
    sessionId: string,
    text: string,
    images: string[],
  ): Promise<{ ok: boolean; error?: string }>;
  /** Simpan gambar sebagai lampiran Session (untuk `images` di prompt). */
  saveImage(sessionId: string, bytes: Uint8Array, mime: string): Result<{ id: string }>;
  /** Daftarkan subscriber gateway; kembalikan fungsi lepas. */
  subscribe(sessionId: string, sub: Subscriber): () => void;
  /** Draf composer bersama Session (tersinkron dengan app). */
  getDraft(sessionId: string): ComposerDraft;
  setDraft(sessionId: string, draft: ComposerDraft, origin: string): void;
  /** Bytes lampiran Session (untuk pratinjau di overlay), atau null. */
  readAttachment(sessionId: string, id: string): { bytes: Uint8Array; mime: string } | null;
}

/** Konteks satu sesi preview (dari tiket). */
export interface OverlayContext {
  projectId: string;
  sessionId: string | null;
  appOrigin: string | null;
}

/** Event yang dikirim ke overlay lewat SSE. */
export type OverlayEvent =
  | { type: "turn"; active: boolean }
  | { type: "status"; status: SessionStatus }
  | { type: "reply"; text: string }
  | { type: "attention"; pending: boolean }
  | { type: "agent_error"; message: string }
  | { type: "server"; server: DevServerStatus | null }
  | { type: "draft"; draft: ComposerDraft; origin: string };

/** Halaman dokumen (navigasi) yang layak diberi overlay. */
export function wantsDocument(req: Request): boolean {
  if (req.method !== "GET") return false;
  const dest = req.headers.get("sec-fetch-dest");
  if (dest) return dest === "document";
  return (req.headers.get("accept") ?? "").includes("text/html");
}

/**
 * Sisipkan `<script>` overlay sedini mungkin (awal `<head>`): penangkap
 * console error harus terpasang sebelum script app berjalan.
 */
export function injectOverlay(html: string): string {
  const tag = `<script src="${OVERLAY_SCRIPT_PATH}" data-kcg-preview></script>`;
  const head = html.match(/<head(?:\s[^>]*)?>/i);
  if (head?.index !== undefined) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + tag + html.slice(at);
  }
  const doctype = html.match(/^\s*<!doctype[^>]*>/i);
  if (doctype) return doctype[0] + tag + html.slice(doctype[0].length);
  return tag + html;
}

/**
 * Tambahkan izin minimal untuk overlay ke CSP dokumen app: script overlay,
 * API overlay (fetch + SSE), dan `blob:` untuk gambar anotasi. Source dibatasi
 * PATH overlay sendiri, jadi request app tetap tunduk pada CSP aslinya.
 * Directive yang tidak ada (jatuh ke `default-src`) dibuat dari salinan
 * `default-src` + izin overlay, supaya fallback lain tidak berubah.
 */
export function allowOverlayInCsp(header: string, origin: string): string {
  const extra: Record<string, string[]> = {
    "script-src": [`${origin}${OVERLAY_SCRIPT_PATH}`],
    "script-src-elem": [`${origin}${OVERLAY_SCRIPT_PATH}`],
    "connect-src": [`${origin}${API_PREFIX}`],
    "img-src": ["blob:"],
  };
  // Beberapa policy dalam satu header dipisah koma; semuanya ditegakkan.
  return header
    .split(",")
    .map((policy) => {
      const directives = policy
        .split(";")
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => {
          const [name = "", ...sources] = d.split(/\s+/);
          return { name: name.toLowerCase(), sources };
        });
      const find = (n: string) => directives.find((d) => d.name === n);
      const fallback = find("default-src");
      for (const [name, add] of Object.entries(extra)) {
        const d = find(name);
        if (d) {
          d.sources = [...d.sources.filter((s) => s !== "'none'"), ...add];
        } else if (fallback && name !== "script-src-elem") {
          // `script-src-elem` yang tidak ada jatuh ke `script-src` (sudah ditangani).
          directives.push({
            name,
            sources: [...fallback.sources.filter((s) => s !== "'none'"), ...add],
          });
        }
      }
      return directives.map((d) => [d.name, ...d.sources].join(" ")).join("; ");
    })
    .join(", ");
}

const OVERLAY_DIR = path.join(import.meta.dir, "overlay");
let scriptCache: Promise<string> | null = null;
/** Waktu ubah terbaru di `overlay/` saat `scriptCache` dibuat. */
let scriptMtime = 0;

/** Waktu ubah terbaru di antara file sumber overlay. */
function overlayMtime(): number {
  let latest = 0;
  for (const name of readdirSync(OVERLAY_DIR)) {
    latest = Math.max(latest, statSync(path.join(OVERLAY_DIR, name)).mtimeMs);
  }
  return latest;
}

/**
 * Bundel overlay (`overlay/index.ts`, lazy) — tanpa langkah build terpisah.
 * Dibundel ulang bila ada file di `overlay/` yang berubah: `bun --hot` tidak
 * memuat ulang modul ini saat hanya file overlay yang diedit (file-file itu
 * tidak di-import di server, jadi cache di memori akan basi).
 */
export function overlayScript(): Promise<string> {
  const mtime = overlayMtime();
  if (mtime !== scriptMtime) {
    scriptCache = null;
    scriptMtime = mtime;
  }
  scriptCache ??= (async () => {
    const res = await Bun.build({
      entrypoints: [path.join(OVERLAY_DIR, "index.ts")],
      target: "browser",
      format: "iife",
      minify: true,
    });
    const out = res.outputs[0];
    if (!res.success || !out) {
      scriptCache = null;
      throw new Error(res.logs.map(String).join("\n") || "overlay build failed");
    }
    return out.text();
  })();
  return scriptCache;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/** Teks balasan assistant (gabungan part `text`), dipotong untuk overlay. */
function replyText(msg: Extract<ServerMessage, { type: "message" }>["message"]): string | null {
  if (msg.role !== "assistant" || msg.streaming) return null;
  const text = msg.parts
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n")
    .trim();
  if (!text) return null;
  return text.length > REPLY_SNIPPET ? `${text.slice(0, REPLY_SNIPPET)}…` : text;
}

/** Pesan gateway -> event overlay (null = tidak relevan). */
export function toOverlayEvent(msg: ServerMessage): OverlayEvent | null {
  switch (msg.type) {
    case "turn_active":
      return { type: "turn", active: msg.active };
    case "session_status":
      return { type: "status", status: msg.status };
    case "message": {
      const text = replyText(msg.message);
      return text ? { type: "reply", text } : null;
    }
    case "prompt":
      return { type: "attention", pending: true };
    case "prompt_resolved":
      return { type: "attention", pending: false };
    case "error":
      return { type: "agent_error", message: msg.message };
    case "draft":
      return { type: "draft", draft: msg.draft, origin: msg.origin };
    default:
      return null;
  }
}

export interface OverlayApi {
  /** `null` = bukan path overlay; lanjutkan ke proxy. */
  handle(req: Request, ctx: OverlayContext): Promise<Response | null>;
  /** Status dev server berubah -> teruskan ke overlay Project terkait. */
  serverChanged(projectId: string, server: DevServerStatus | null): void;
}

export function createOverlayApi(deps: {
  bridge: PreviewBridge | null;
  serverStatus: (projectId: string) => DevServerStatus | null;
  /** Alamat dev server yang siap (untuk screenshot). */
  upstream: (projectId: string) => { host: string; port: number } | null;
  screenshotter: Screenshotter | null;
  /** Viewport perangkat yang membuka preview (dipakai snapshot otomatis). */
  onViewport?: (projectId: string, viewport: Partial<Viewport>) => void;
}): OverlayApi {
  const streams = new Set<{ projectId: string; push: (e: OverlayEvent) => void }>();

  function chatUrl(ctx: OverlayContext): string | null {
    if (!ctx.appOrigin) return null;
    const base = `${ctx.appOrigin}/projects/${encodeURIComponent(ctx.projectId)}`;
    return ctx.sessionId ? `${base}/sessions/${encodeURIComponent(ctx.sessionId)}` : base;
  }

  function sessionInfo(ctx: OverlayContext): PreviewSessionInfo | null {
    if (!deps.bridge || !ctx.sessionId) return null;
    return deps.bridge.session(ctx.projectId, ctx.sessionId);
  }

  function events(req: Request, ctx: OverlayContext): Response {
    const encoder = new TextEncoder();
    let cleanup = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const write = (chunk: string) => {
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            cleanup();
          }
        };
        const push = (e: OverlayEvent) => write(`data: ${JSON.stringify(e)}\n\n`);
        const entry = { projectId: ctx.projectId, push };
        streams.add(entry);

        let unsubscribe = () => {};
        const info = sessionInfo(ctx);
        if (deps.bridge && info) {
          const sub: Subscriber = {
            send: (msg) => {
              const e = toOverlayEvent(msg);
              if (e) push(e);
            },
            close: () => cleanup(),
          };
          unsubscribe = deps.bridge.subscribe(info.id, sub);
        }
        const keepalive = setInterval(() => write(": ping\n\n"), KEEPALIVE_MS);
        cleanup = () => {
          clearInterval(keepalive);
          streams.delete(entry);
          unsubscribe();
          cleanup = () => {};
        };
        req.signal.addEventListener("abort", () => cleanup());
        write(": connected\n\n");
      },
      cancel() {
        cleanup();
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        // Jangan di-buffer reverse proxy (Caddy/nginx) di depan frps.
        "x-accel-buffering": "no",
      },
    });
  }

  async function prompt(req: Request, ctx: OverlayContext): Promise<Response> {
    const info = sessionInfo(ctx);
    if (!deps.bridge || !info) return json({ error: "PREVIEW_NO_SESSION" }, 409);
    let body: { text?: unknown; images?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return json({ error: "INVALID_JSON" }, 400);
    }
    const { text } = body;
    if (typeof text !== "string" || text.trim() === "") return json({ error: "INVALID_TEXT" }, 400);
    if (text.length > MAX_PROMPT_LENGTH) return json({ error: "TEXT_TOO_LONG" }, 400);
    const images = Array.isArray(body.images)
      ? body.images
          .filter((i): i is string => typeof i === "string")
          .slice(0, DRAFT_LIMITS.attachments)
      : [];
    const res = await deps.bridge.sendPrompt(info.id, text, images);
    return res.ok ? json({ ok: true }) : json({ error: res.error ?? "ERROR" }, 409);
  }

  async function screenshot(req: Request, ctx: OverlayContext): Promise<Response> {
    if (!deps.screenshotter?.available()) return json({ error: "PREVIEW_NO_BROWSER" }, 501);
    const up = deps.upstream(ctx.projectId);
    if (!up) return json({ error: "PREVIEW_NOT_RUNNING" }, 409);
    let body: Partial<Viewport> & { path?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return json({ error: "INVALID_JSON" }, 400);
    }
    const p = typeof body.path === "string" && body.path.startsWith("/") ? body.path : "/";
    const host = up.host.includes(":") ? `[${up.host}]` : up.host;
    const shot = await deps.screenshotter.capture(`http://${host}:${up.port}${p}`, body);
    if (!shot.ok) return json({ error: shot.error }, 502);
    return new Response(shot.data, {
      headers: { "content-type": "image/jpeg", "cache-control": "no-store" },
    });
  }

  async function upload(req: Request, ctx: OverlayContext): Promise<Response> {
    const info = sessionInfo(ctx);
    if (!deps.bridge || !info) return json({ error: "PREVIEW_NO_SESSION" }, 409);
    const mime = (req.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
    if (!IMAGE_MIME.has(mime)) return json({ error: "UNSUPPORTED_TYPE" }, 415);
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.length === 0) return json({ error: "EMPTY_UPLOAD" }, 400);
    if (bytes.length > MAX_UPLOAD_BYTES) return json({ error: "FILE_TOO_LARGE" }, 413);
    const saved = deps.bridge.saveImage(info.id, bytes, mime);
    return saved.ok ? json({ id: saved.data.id }) : json({ error: saved.error }, 400);
  }

  async function draft(req: Request, ctx: OverlayContext): Promise<Response> {
    const info = sessionInfo(ctx);
    if (!deps.bridge || !info) return json({ error: "PREVIEW_NO_SESSION" }, 409);
    let body: { draft?: unknown; origin?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return json({ error: "INVALID_JSON" }, 400);
    }
    const next = parseDraft(body.draft);
    if (!next || !isValidOrigin(body.origin)) return json({ error: "INVALID_DRAFT" }, 400);
    deps.bridge.setDraft(info.id, next, body.origin);
    return json({ ok: true });
  }

  /** Gambar lampiran Session — hanya gambar yang aman ditampilkan inline. */
  function attachment(id: string, ctx: OverlayContext): Response {
    const info = sessionInfo(ctx);
    if (!deps.bridge || !info) return json({ error: "PREVIEW_NO_SESSION" }, 409);
    const file = deps.bridge.readAttachment(info.id, id);
    if (!file) return json({ error: "NOT_FOUND" }, 404);
    if (!isPreviewableImage(file.mime)) return json({ error: "UNSUPPORTED_TYPE" }, 415);
    // Salin ke Uint8Array ber-buffer ArrayBuffer agar lolos tipe BodyInit.
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "content-type": file.mime,
        "cache-control": "private, max-age=3600",
        "x-content-type-options": "nosniff",
      },
    });
  }

  return {
    async handle(req, ctx) {
      const { pathname } = new URL(req.url);
      if (!pathname.startsWith(OVERLAY_PREFIX)) return null;
      if (pathname === OVERLAY_SCRIPT_PATH) {
        try {
          return new Response(await overlayScript(), {
            headers: {
              "content-type": "text/javascript; charset=utf-8",
              "cache-control": "no-cache",
            },
          });
        } catch (err) {
          console.error("[kcg-code] overlay preview gagal dibundel:", err);
          return new Response("/* overlay unavailable */", {
            headers: { "content-type": "text/javascript" },
          });
        }
      }
      if (pathname === `${API_PREFIX}state` && req.method === "GET") {
        // Overlay melaporkan viewport perangkat (untuk snapshot otomatis).
        const q = new URL(req.url).searchParams;
        const num = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined);
        if (q.has("vw")) {
          deps.onViewport?.(ctx.projectId, {
            width: num("vw"),
            height: num("vh"),
            dpr: num("dpr"),
          });
        }
        return json({
          session: sessionInfo(ctx),
          chatUrl: chatUrl(ctx),
          server: deps.serverStatus(ctx.projectId),
          screenshots: deps.screenshotter?.available() ?? false,
          draft: (() => {
            const info = sessionInfo(ctx);
            return deps.bridge && info ? deps.bridge.getDraft(info.id) : EMPTY_DRAFT;
          })(),
        });
      }
      if (pathname === `${API_PREFIX}screenshot` && req.method === "POST") {
        return screenshot(req, ctx);
      }
      if (pathname === `${API_PREFIX}upload` && req.method === "POST") return upload(req, ctx);
      if (pathname === `${API_PREFIX}events` && req.method === "GET") return events(req, ctx);
      if (pathname === `${API_PREFIX}prompt` && req.method === "POST") return prompt(req, ctx);
      if (pathname === `${API_PREFIX}draft` && req.method === "POST") return draft(req, ctx);
      if (pathname.startsWith(`${API_PREFIX}attachment/`) && req.method === "GET") {
        return attachment(pathname.slice(`${API_PREFIX}attachment/`.length), ctx);
      }
      return json({ error: "NOT_FOUND" }, 404);
    },
    serverChanged(projectId, server) {
      for (const s of streams) if (s.projectId === projectId) s.push({ type: "server", server });
    },
  };
}
