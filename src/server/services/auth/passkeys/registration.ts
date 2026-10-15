/**
 * Alur pendaftaran passkey: buat options (wajib kunci aktif, origin ketat,
 * batas jumlah, konfirmasi sandi saat ini) lalu verifikasi attestation dan
 * simpan kunci publiknya.
 */
import { randomBytes, randomUUID } from "node:crypto";
import {
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  type verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { SessionStore } from "../../../../db";
import type { PasskeyRow } from "../../../db/auth";
import type { Result } from "../../../result";
import type { AuthService } from "../types";
import type { ChallengeStore } from "./challenges";
import { cleanPasskeyName, defaultPasskeyName, toPasskeyInfo } from "./info";
import { webAuthnOrigin } from "./origin";
import { CHALLENGE_TTL_MS, PASSKEY_MAX, type PasskeyInfo, RP_NAME, USER_NAME } from "./types";

export interface RegistrationDeps {
  store: SessionStore;
  auth: AuthService;
  now: () => number;
  challenges: ChallengeStore;
  verifyReg: typeof verifyRegistrationResponse;
}

export function createRegistrationFlow(deps: RegistrationDeps) {
  const { store, auth, now, challenges, verifyReg } = deps;

  async function registrationOptions(req: Request, current: string, ip: string) {
    if (!auth.isProtected()) return { ok: false as const, error: "PASSKEY_LOCK_REQUIRED" };
    const o = webAuthnOrigin(req);
    if (!o) return { ok: false as const, error: "PASSKEY_UNSUPPORTED_ORIGIN" };
    if (store.listPasskeys().length >= PASSKEY_MAX) {
      return { ok: false as const, error: "PASSKEY_LIMIT" };
    }
    // Pendaftaran = mengubah cara buka kunci -> konfirmasi sandi saat ini.
    const check = await auth.internal.checkCurrentSecret(current, ip);
    if (!check.ok) return { ok: false as const, error: check.error ?? "CURRENT_SECRET_INVALID" };

    const existing = store.listPasskeys(o.rpId);
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: o.rpId,
      userName: USER_NAME,
      userDisplayName: store.getAuthSettings(now()).nickname ?? RP_NAME,
      // Handle acak per pendaftaran: tidak ada identitas pengguna yang dibagi.
      userID: new Uint8Array(randomBytes(16)),
      timeout: CHALLENGE_TTL_MS,
      attestationType: "none",
      excludeCredentials: existing.map((p) => ({ id: p.credentialId, transports: p.transports })),
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    const challengeId = challenges.put({
      kind: "register",
      challenge: options.challenge,
      rpId: o.rpId,
      origin: o.origin,
    });
    return { ok: true as const, data: { challengeId, options } };
  }

  async function register(
    req: Request,
    input: { challengeId: string; response: RegistrationResponseJSON; name?: string },
  ): Promise<Result<PasskeyInfo>> {
    if (!auth.isProtected()) return { ok: false, error: "PASSKEY_LOCK_REQUIRED" };
    const o = webAuthnOrigin(req);
    if (!o) return { ok: false, error: "PASSKEY_UNSUPPORTED_ORIGIN" };
    const c = challenges.take(input.challengeId, "register", o);
    if (!c) return { ok: false, error: "PASSKEY_CHALLENGE_INVALID" };
    if (!input.response || typeof input.response !== "object") {
      return { ok: false, error: "PASSKEY_VERIFY_FAILED" };
    }
    let verified: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      verified = await verifyReg({
        response: input.response,
        expectedChallenge: c.challenge,
        expectedOrigin: c.origin,
        expectedRPID: c.rpId,
        requireUserVerification: true,
      });
    } catch {
      return { ok: false, error: "PASSKEY_VERIFY_FAILED" };
    }
    if (!verified.verified) return { ok: false, error: "PASSKEY_VERIFY_FAILED" };
    const info = verified.registrationInfo;
    if (store.getPasskeyByCredentialId(info.credential.id)) {
      return { ok: false, error: "PASSKEY_ALREADY_REGISTERED" };
    }
    const name =
      (input.name !== undefined ? cleanPasskeyName(input.name) : null) ??
      defaultPasskeyName(req.headers.get("user-agent"));
    const row: PasskeyRow = {
      id: randomUUID(),
      credentialId: info.credential.id,
      publicKey: info.credential.publicKey,
      counter: info.credential.counter,
      transports: info.credential.transports ?? [],
      rpId: c.rpId,
      name,
      deviceType: info.credentialDeviceType,
      backedUp: info.credentialBackedUp,
      createdAt: now(),
      lastUsedAt: null,
    };
    store.insertPasskey(row);
    return { ok: true, data: toPasskeyInfo(row, c.rpId) };
  }

  return { registrationOptions, register };
}
