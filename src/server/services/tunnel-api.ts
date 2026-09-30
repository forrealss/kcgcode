/**
 * Client HTTP untuk API device kcgcode-rp (`reverse-proxy/REQUEST.md`).
 *
 * Kode error domain:
 * - `TUNNEL_DEVICE_REVOKED`  — device token ditolak (401): perangkat dicabut
 * - `TUNNEL_RATE_LIMITED`    — 429
 * - `TUNNEL_API_UNREACHABLE` — jaringan / 5xx / respons tak dikenal
 */
import type { Result } from "../result";

export interface DeviceStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

export interface DeviceGrant {
  deviceToken: string;
  deviceId: string;
  email: string;
  username: string;
  subdomain: string;
  tunnelSecret: string;
}

/** Hasil satu kali polling `/device/token` (RFC 8628 §3.5). */
export type PollResult =
  | { state: "granted"; grant: DeviceGrant }
  | { state: "pending" }
  | { state: "slow_down" }
  | { state: "denied" }
  | { state: "expired" };

export interface TunnelApi {
  startDevice(deviceName: string, localPort: number): Promise<Result<DeviceStart>>;
  pollDevice(deviceCode: string): Promise<Result<PollResult>>;
  /** Isi `frpc.toml` (text) untuk port lokal ini. */
  fetchConfig(deviceToken: string, localPort: number): Promise<Result<string>>;
  rotateSecret(deviceToken: string): Promise<Result<string>>;
  /** Cabut device ini di VPS (best effort saat sign out). */
  revokeSelf(deviceToken: string): Promise<Result<null>>;
}

const TIMEOUT_MS = 15_000;

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

export function createTunnelApi(baseUrl: string, doFetch: typeof fetch = fetch): TunnelApi {
  async function call(
    path: string,
    init: RequestInit & { token?: string } = {},
  ): Promise<Result<Response>> {
    const headers = new Headers(init.headers);
    if (init.body != null) headers.set("content-type", "application/json");
    if (init.token) headers.set("authorization", `Bearer ${init.token}`);
    try {
      const res = await doFetch(`${baseUrl}${path}`, {
        ...init,
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return { ok: true, data: res };
    } catch (e) {
      console.error(`[kcg-code] tunnel API ${path} gagal:`, (e as Error).message);
      return { ok: false, error: "TUNNEL_API_UNREACHABLE" };
    }
  }

  function httpError(res: Response): string {
    if (res.status === 401) return "TUNNEL_DEVICE_REVOKED";
    if (res.status === 429) return "TUNNEL_RATE_LIMITED";
    return "TUNNEL_API_UNREACHABLE";
  }

  async function readJson(res: Response): Promise<Record<string, unknown> | null> {
    try {
      const j = await res.json();
      return j && typeof j === "object" ? (j as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  return {
    async startDevice(deviceName, localPort) {
      const r = await call("/api/v1/device/start", {
        method: "POST",
        body: JSON.stringify({ device_name: deviceName, local_port: localPort }),
      });
      if (!r.ok) return r;
      if (!r.data.ok) return { ok: false, error: httpError(r.data) };
      const j = await readJson(r.data);
      const deviceCode = str(j?.device_code);
      const userCode = str(j?.user_code);
      const verificationUri = str(j?.verification_uri);
      const verificationUriComplete = str(j?.verification_uri_complete);
      // Tautan hanya boleh ke origin API yang dikonfigurasi (bukan open redirect).
      const sameOrigin = (u: string | null) => {
        try {
          return u !== null && new URL(u).origin === new URL(baseUrl).origin;
        } catch {
          return false;
        }
      };
      if (
        !deviceCode ||
        !userCode ||
        !sameOrigin(verificationUri) ||
        !sameOrigin(verificationUriComplete)
      ) {
        return { ok: false, error: "TUNNEL_API_UNREACHABLE" };
      }
      return {
        ok: true,
        data: {
          deviceCode,
          userCode,
          verificationUri: verificationUri as string,
          verificationUriComplete: verificationUriComplete as string,
          expiresIn: typeof j?.expires_in === "number" ? j.expires_in : 600,
          interval: typeof j?.interval === "number" ? Math.max(1, j.interval) : 5,
        },
      };
    },

    async pollDevice(deviceCode) {
      const r = await call("/api/v1/device/token", {
        method: "POST",
        body: JSON.stringify({ device_code: deviceCode }),
      });
      if (!r.ok) return r;
      const j = await readJson(r.data);
      if (r.data.ok) {
        const deviceToken = str(j?.device_token);
        const deviceId = str(j?.device_id);
        const email = str(j?.email);
        const username = str(j?.username);
        const subdomain = str(j?.subdomain);
        const tunnelSecret = str(j?.tunnel_secret);
        if (!deviceToken || !deviceId || !email || !username || !subdomain || !tunnelSecret) {
          return { ok: false, error: "TUNNEL_API_UNREACHABLE" };
        }
        return {
          ok: true,
          data: {
            state: "granted",
            grant: { deviceToken, deviceId, email, username, subdomain, tunnelSecret },
          },
        };
      }
      switch (j?.error) {
        case "authorization_pending":
          return { ok: true, data: { state: "pending" } };
        case "slow_down":
          return { ok: true, data: { state: "slow_down" } };
        case "access_denied":
          return { ok: true, data: { state: "denied" } };
        case "expired_token":
        case "invalid_grant":
          return { ok: true, data: { state: "expired" } };
        default:
          return { ok: false, error: httpError(r.data) };
      }
    },

    async fetchConfig(deviceToken, localPort) {
      const r = await call(`/api/v1/device/tunnel/config?local_port=${localPort}`, {
        token: deviceToken,
      });
      if (!r.ok) return r;
      if (!r.data.ok) return { ok: false, error: httpError(r.data) };
      const text = await r.data.text();
      if (!/\[\[proxies\]\]/.test(text)) return { ok: false, error: "TUNNEL_API_UNREACHABLE" };
      return { ok: true, data: text };
    },

    async rotateSecret(deviceToken) {
      const r = await call("/api/v1/device/tunnel/rotate", {
        method: "POST",
        token: deviceToken,
        body: "{}",
      });
      if (!r.ok) return r;
      if (!r.data.ok) return { ok: false, error: httpError(r.data) };
      const secret = str((await readJson(r.data))?.tunnel_secret);
      if (!secret) return { ok: false, error: "TUNNEL_API_UNREACHABLE" };
      return { ok: true, data: secret };
    },

    async revokeSelf(deviceToken) {
      const r = await call("/api/v1/device/devices/self", {
        method: "DELETE",
        token: deviceToken,
      });
      if (!r.ok) return r;
      // 401 = sudah dicabut — tujuan tercapai.
      if (!r.data.ok && r.data.status !== 401) return { ok: false, error: httpError(r.data) };
      return { ok: true, data: null };
    },
  };
}
