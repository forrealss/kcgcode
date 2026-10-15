/**
 * Passkey (WebAuthn) — cara buka kunci TAMBAHAN di samping PIN/password.
 *
 * Model keamanan:
 * - PIN/password tetap wajib ada (cadangan bila passkey tak bisa dipakai).
 *   Mendaftarkan passkey butuh sesi login + konfirmasi sandi saat ini.
 *   Menghapus kunci / `kcgcode reset-lock` ikut menghapus semua passkey.
 * - Passkey terikat domain (RP ID). RP ID & origin diturunkan dari header
 *   `Origin` request yang WAJIB sama dengan host tujuan (pola yang sama
 *   dengan `originAllowed`) — tidak pernah dari input body. Hanya secure
 *   context (https, atau http://localhost) yang didukung, sesuai aturan
 *   WebAuthn di browser.
 * - Challenge sekali pakai, kedaluwarsa 5 menit, disimpan di memori server
 *   (bukan di klien). Login passkey kena anti brute-force yang sama dengan
 *   PIN/password.
 * - Verifikasi kriptografi (attestation, signature, counter) oleh
 *   `@simplewebauthn/server`. User verification (biometrik / PIN perangkat)
 *   diwajibkan.
 * - Hanya kunci publik yang disimpan.
 *
 * Bagian yang berdiri sendiri ada di `./auth/passkeys/`: kontrak publik &
 * konstanta (`types`), penurunan origin/RP ID (`origin`), util nama & info
 * (`info`), penyimpanan challenge (`challenges`), alur pendaftaran
 * (`registration`), dan alur login (`authentication`). File ini merakitnya
 * dan memegang daftar/kelola passkey.
 */
import { verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import type { Result } from "../result";
import { createAuthenticationFlow } from "./auth/passkeys/authentication";
import { createChallengeStore } from "./auth/passkeys/challenges";
import { cleanPasskeyName, toPasskeyInfo } from "./auth/passkeys/info";
import { webAuthnOriginForRead } from "./auth/passkeys/origin";
import { createRegistrationFlow } from "./auth/passkeys/registration";
import type {
  PasskeyAvailability,
  PasskeyInfo,
  PasskeyService,
  PasskeyServiceOptions,
} from "./auth/passkeys/types";

export { cleanPasskeyName, defaultPasskeyName } from "./auth/passkeys/info";
export { webAuthnOrigin, webAuthnOriginForRead } from "./auth/passkeys/origin";
export {
  CHALLENGE_TTL_MS,
  PASSKEY_MAX,
  PASSKEY_NAME_MAX,
  type PasskeyAvailability,
  type PasskeyInfo,
  type PasskeyService,
  type PasskeyServiceOptions,
  type WebAuthnOrigin,
} from "./auth/passkeys/types";

export function createPasskeyService(opts: PasskeyServiceOptions): PasskeyService {
  const { store, auth } = opts;
  const now = opts.now ?? Date.now;
  const verifyReg = opts.verifyRegistration ?? verifyRegistrationResponse;
  const verifyAuth = opts.verifyAuthentication ?? verifyAuthenticationResponse;
  const challenges = createChallengeStore(now);

  const { registrationOptions, register } = createRegistrationFlow({
    store,
    auth,
    now,
    challenges,
    verifyReg,
  });
  const { authenticationOptions, login } = createAuthenticationFlow({
    store,
    auth,
    now,
    challenges,
    verifyAuth,
  });

  function availability(req: Request): PasskeyAvailability {
    // GET dari lock screen: browser tidak mengirim Origin (lihat
    // `webAuthnOriginForRead`).
    const o = webAuthnOriginForRead(req);
    if (!o || !auth.isProtected()) return { supported: o !== null, count: 0 };
    return { supported: true, count: store.listPasskeys(o.rpId).length };
  }

  function list(req: Request): PasskeyInfo[] {
    const rp = webAuthnOriginForRead(req)?.rpId ?? null;
    return store.listPasskeys().map((p) => toPasskeyInfo(p, rp));
  }

  function rename(id: string, name: string): Result<PasskeyInfo> {
    const p = store.getPasskeyById(id);
    if (!p) return { ok: false, error: "PASSKEY_NOT_FOUND" };
    const clean = typeof name === "string" ? cleanPasskeyName(name) : null;
    if (!clean) return { ok: false, error: "PASSKEY_NAME_INVALID" };
    store.renamePasskey(id, clean);
    return { ok: true, data: toPasskeyInfo({ ...p, name: clean }, null) };
  }

  function remove(id: string): Result<null> {
    if (!store.getPasskeyById(id)) return { ok: false, error: "PASSKEY_NOT_FOUND" };
    store.deletePasskey(id);
    return { ok: true, data: null };
  }

  return {
    availability,
    list,
    registrationOptions,
    register,
    authenticationOptions,
    login,
    rename,
    remove,
  };
}
