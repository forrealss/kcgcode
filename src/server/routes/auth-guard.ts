/**
 * Penjaga HTTP untuk kunci aplikasi: baca cookie sesi, cek Origin (anti
 * CSRF / cross-site WebSocket hijacking), dan bungkus setiap handler rute
 * `/api/*` agar menolak request tanpa sesi valid (401).
 *
 * Rute publik (lock screen butuh ini sebelum login): status, login, avatar.
 */
import type { Server } from "bun";
import type { AuthService } from "../services/auth";
import { SESSION_COOKIE, SESSION_TTL_MS } from "../services/auth";
import { json } from "./helpers";

/**
 * Rute + method yang boleh diakses tanpa login (dibutuhkan lock screen).
 * Per method: `GET /api/auth/avatar` publik, tapi `PUT`/`DELETE`-nya tidak.
 */
export const PUBLIC_API: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["/api/auth/status", new Set(["GET"])],
  ["/api/auth/login", new Set(["POST"])],
  ["/api/auth/avatar", new Set(["GET"])],
]);

export function isPublicApi(route: string, method: string): boolean {
  return PUBLIC_API.get(route)?.has(method) ?? false;
}

export function readSessionToken(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === SESSION_COOKIE) {
      const v = part.slice(idx + 1).trim();
      return v === "" ? null : decodeURIComponent(v);
    }
  }
  return null;
}

/** Request datang lewat HTTPS (langsung atau lewat tunnel/proxy). */
function isSecure(req: Request): boolean {
  if (new URL(req.url).protocol === "https:") return true;
  return req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https";
}

export function sessionCookie(req: Request, token: string): string {
  const attrs = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (isSecure(req)) attrs.push("Secure");
  return attrs.join("; ");
}

export function clearSessionCookie(req: Request): string {
  const attrs = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
  if (isSecure(req)) attrs.push("Secure");
  return attrs.join("; ");
}

/**
 * Origin harus sama dengan host tujuan untuk request yang mengubah state
 * dan untuk upgrade WebSocket. Cookie `SameSite=Strict` sudah menahan
 * sebagian besar CSRF; ini lapis kedua (juga menutup WebSocket lintas situs,
 * yang tidak dibatasi CORS).
 */
export function originAllowed(req: Request): boolean {
  const origin = req.headers.get("origin");
  // Tanpa Origin (curl, request same-origin GET lama) -> tidak ada konteks
  // lintas situs; cookie tetap wajib valid.
  if (origin === null) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const hosts = new Set<string>();
  const host = req.headers.get("host");
  if (host) hosts.add(host);
  const fwd = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (fwd) hosts.add(fwd);
  hosts.add(new URL(req.url).host);
  return hosts.has(originHost);
}

/** IP klien untuk pembatasan percobaan (tunnel biasanya lewat localhost). */
export function clientIp(req: Request, server: Server<unknown> | undefined): string {
  const direct = server?.requestIP(req)?.address ?? "unknown";
  // Header proxy hanya dipercaya bila koneksi datang dari mesin ini (tunnel
  // lokal seperti cloudflared/ngrok) — dari luar, header mudah dipalsukan.
  const loopback = direct === "127.0.0.1" || direct === "::1" || direct === "::ffff:127.0.0.1";
  if (loopback) {
    const fwd =
      req.headers.get("cf-connecting-ip") ??
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip");
    if (fwd) return fwd.slice(0, 64);
  }
  return direct;
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type AnyHandler = (req: Request, server: Server<unknown>) => unknown;

/**
 * Bungkus satu handler: cek Origin untuk method yang mengubah state, lalu
 * wajibkan sesi valid (kecuali rute publik / kunci belum diatur).
 */
export function guardHandler(auth: AuthService, route: string, handler: AnyHandler): AnyHandler {
  return (req, server) => {
    if (MUTATING.has(req.method) && !originAllowed(req)) {
      return json({ error: "ORIGIN_FORBIDDEN" }, 403);
    }
    if (!isPublicApi(route, req.method) && auth.isProtected()) {
      if (!auth.authenticate(readSessionToken(req))) {
        return json({ error: "AUTH_REQUIRED" }, 401);
      }
    }
    return handler(req, server);
  };
}

/**
 * Terapkan `guardHandler` ke seluruh tabel rute `/api/*` (handler tunggal
 * maupun per-method). Rute non-API dikembalikan apa adanya.
 */
export function guardRoutes<T extends Record<string, unknown>>(auth: AuthService, routes: T): T {
  const out: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(routes)) {
    if (!path.startsWith("/api/")) {
      out[path] = value;
    } else if (typeof value === "function") {
      out[path] = guardHandler(auth, path, value as AnyHandler);
    } else if (value && typeof value === "object" && !(value instanceof Response)) {
      const methods: Record<string, unknown> = {};
      for (const [m, h] of Object.entries(value as Record<string, unknown>)) {
        methods[m] = typeof h === "function" ? guardHandler(auth, path, h as AnyHandler) : h;
      }
      out[path] = methods;
    } else {
      out[path] = value;
    }
  }
  return out as T;
}
