/**
 * Verifikasi PIN/password saat ini dengan penundaan anti brute-force.
 * Waktu verifikasi dibuat sama walau kunci belum diatur (hash dummy) agar
 * tidak membocorkan status kunci.
 */
import type { AuthSettings } from "../../db/auth";
import type { Result } from "../../result";
import type { FailureTracker } from "./lockout";
import { PASSWORD_MAX } from "./types";

/** Hash dummy agar verifikasi tanpa kunci tetap memakan waktu yang sama. */
let dummyHashPromise: Promise<string> | null = null;

export interface SecretCheckerDeps {
  failures: FailureTracker;
  settings: () => AuthSettings;
  hash: (secret: string) => Promise<string>;
  verify: (secret: string, hash: string) => Promise<boolean>;
}

/** Verifikasi sandi dengan penundaan anti brute-force. */
export type SecretChecker = (secret: string, ip: string) => Promise<Result<null>>;

export function createSecretChecker(deps: SecretCheckerDeps): SecretChecker {
  const { failures, settings, hash, verify } = deps;
  return async function checkSecret(secret: string, ip: string): Promise<Result<null>> {
    const wait = failures.retryAfterMs(ip);
    if (wait > 0) return { ok: false, error: `AUTH_RATE_LIMITED:${Math.ceil(wait / 1000)}` };
    const s = settings();
    if (typeof secret !== "string" || secret.length === 0 || secret.length > PASSWORD_MAX) {
      failures.recordFailure(ip);
      return { ok: false, error: "AUTH_INVALID" };
    }
    let ok = false;
    if (s.lockHash) {
      ok = await verify(secret, s.lockHash);
    } else {
      // Tetap habiskan waktu verifikasi agar tidak membocorkan status.
      dummyHashPromise ??= hash("kcg-dummy-secret");
      await verify(secret, await dummyHashPromise);
    }
    if (!ok) {
      failures.recordFailure(ip);
      const next = failures.retryAfterMs(ip);
      return {
        ok: false,
        error: next > 0 ? `AUTH_RATE_LIMITED:${Math.ceil(next / 1000)}` : "AUTH_INVALID",
      };
    }
    failures.recordSuccess(ip);
    return { ok: true, data: null };
  };
}

/**
 * Kode error untuk verifikasi "sandi saat ini": `AUTH_INVALID` menjadi
 * `CURRENT_SECRET_INVALID`; error lain (mis. rate limit) diteruskan apa adanya.
 */
export function currentSecretError(error: string): string {
  return error === "AUTH_INVALID" ? "CURRENT_SECRET_INVALID" : error;
}
