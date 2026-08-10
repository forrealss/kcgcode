/**
 * Middleware otentikasi & bind jaringan.
 * Sesuai `design.md` — `auth.ts`.
 *
 * - Default `hostname` loopback `127.0.0.1` via `process.env.KCG_HOST` (Req 9.1).
 * - Bila `KCG_AUTH_ENABLED === "true"`, setiap request HTTP / upgrade WebSocket
 *   harus menyertakan header `Authorization: Bearer <token>` (HTTP) atau
 *   query `?token=` (upgrade WS, karena browser WebSocket API tidak mendukung
 *   header custom) yang cocok dengan `process.env.KCG_AUTH_TOKEN` (Req 9.2, 9.3).
 * - Tidak cocok / tidak ada kredensial -> HTTP 401 atau WS close code 4401.
 */
export const DEFAULT_HOSTNAME = "127.0.0.1";
export const WS_AUTH_CLOSE_CODE = 4401;

export interface AuthConfig {
  hostname: string;
  authEnabled: boolean;
  authToken: string;
}

export interface AuthRequest {
  /** Nilai mentah header `Authorization`, atau null bila tidak ada. */
  authHeader: string | null;
  /** Nilai query param `token` untuk upgrade WebSocket, atau null. */
  queryToken: string | null;
}

/** Membaca konfigurasi otentikasi dari environment (default: `process.env`). */
export function loadAuthConfig(env: Record<string, string | undefined> = process.env): AuthConfig {
  return {
    hostname: env.KCG_HOST ?? DEFAULT_HOSTNAME,
    authEnabled: env.KCG_AUTH_ENABLED === "true",
    authToken: env.KCG_AUTH_TOKEN ?? "",
  };
}

/**
 * Mengekstrak token dari header `Authorization: Bearer <token>`.
 * Mengembalikan null bila header tidak ada atau tidak berbentuk Bearer.
 */
export function bearerToken(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return m?.[1] ?? null;
}

/**
 * Validasi kredensial terhadap konfigurasi (Req 9.2, 9.3).
 * - Auth mati (`KCG_AUTH_ENABLED !== "true"`): selalu diterima, tanpa kredensial.
 * - Auth aktif: diterima **hanya bila** token efektif (Bearer header, atau query
 *   token bila header tidak membawa Bearer) sama persis dengan token terkonfigurasi.
 * - Token terkonfigurasi kosong saat auth aktif dianggap salah konfigurasi:
 *   seluruh permintaan ditolak.
 */
export function isAuthorized(config: AuthConfig, req: AuthRequest): boolean {
  if (!config.authEnabled) return true;
  if (config.authToken.length === 0) return false;
  const provided = bearerToken(req.authHeader) ?? req.queryToken;
  return provided !== null && provided === config.authToken;
}

/** Respon HTTP 401 untuk permintaan yang tidak terotentikasi (Req 9.2). */
export function unauthorizedResponse(): Response {
  return new Response("Unauthorized", { status: 401, headers: { "content-type": "text/plain" } });
}
