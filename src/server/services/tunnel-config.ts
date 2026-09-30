/**
 * Tunnel server (kcgcode-rp) configuration. No domain is hard-coded: the API
 * URL is set per build, and each tunnel's public address (`<username>.<domain>`)
 * is sent by the server when the device connects.
 *
 * Order: env `KCG_TUNNEL_API_URL` (e.g. `.env` in development) -> the URL baked
 * into the npm package at publish time (`src/build-config.ts`) -> not set
 * (Remote access shows "Not configured").
 */
import { BUILD_TUNNEL_API_URL } from "../../build-config";

export interface TunnelConfig {
  /** kcgcode-rp API URL without a trailing slash; null = tunnel disabled. */
  apiUrl: string | null;
}

/** Validate a tunnel API URL: http(s), no credentials/query/fragment. */
export function parseTunnelApiUrl(raw: unknown): { ok: true; url: string | null } | { ok: false } {
  if (raw === undefined || raw === null || raw === "") return { ok: true, url: null };
  if (typeof raw !== "string") return { ok: false };
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false };
  if (u.username || u.password || u.search || u.hash) return { ok: false };
  return { ok: true, url: `${u.origin}${u.pathname}`.replace(/\/+$/, "") };
}

/** `env`/`built` are injectable for tests; pass "" to mean "not set". */
export function resolveTunnelConfig(
  env: string | undefined = process.env.KCG_TUNNEL_API_URL,
  built: string = BUILD_TUNNEL_API_URL,
): TunnelConfig {
  const fromEnv = env?.trim();
  if (fromEnv) {
    const parsed = parseTunnelApiUrl(fromEnv);
    if (parsed.ok && parsed.url) return { apiUrl: parsed.url };
    console.warn("[kcg-code] KCG_TUNNEL_API_URL is not a valid http(s) URL; ignoring it.");
  }
  const fromBuild = parseTunnelApiUrl(built);
  return { apiUrl: fromBuild.ok ? fromBuild.url : null };
}
