/**
 * Alur login passkey: buat options (publik, kena rate limit) lalu verifikasi
 * signature + counter dan terbitkan sesi. Memakai anti brute-force yang sama
 * dengan PIN/password (`auth.internal`).
 */
import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  type verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type { SessionStore } from "../../../../db";
import type { Result } from "../../../result";
import type { AuthService, IssuedSession, LoginContext } from "../types";
import type { ChallengeStore } from "./challenges";
import { webAuthnOrigin } from "./origin";
import { CHALLENGE_TTL_MS } from "./types";

export interface AuthenticationDeps {
  store: SessionStore;
  auth: AuthService;
  now: () => number;
  challenges: ChallengeStore;
  verifyAuth: typeof verifyAuthenticationResponse;
}

export function createAuthenticationFlow(deps: AuthenticationDeps) {
  const { store, auth, now, challenges, verifyAuth } = deps;

  async function authenticationOptions(req: Request, ip: string) {
    if (!auth.isProtected()) return { ok: false as const, error: "AUTH_NOT_CONFIGURED" };
    const o = webAuthnOrigin(req);
    if (!o) return { ok: false as const, error: "PASSKEY_UNSUPPORTED_ORIGIN" };
    const wait = auth.internal.retryAfterSec(ip);
    if (wait > 0) return { ok: false as const, error: `AUTH_RATE_LIMITED:${wait}` };
    const creds = store.listPasskeys(o.rpId);
    if (creds.length === 0) return { ok: false as const, error: "PASSKEY_NONE" };
    const options = await generateAuthenticationOptions({
      rpID: o.rpId,
      timeout: CHALLENGE_TTL_MS,
      userVerification: "required",
      allowCredentials: creds.map((p) => ({ id: p.credentialId, transports: p.transports })),
    });
    const challengeId = challenges.put({
      kind: "login",
      challenge: options.challenge,
      rpId: o.rpId,
      origin: o.origin,
    });
    return { ok: true as const, data: { challengeId, options } };
  }

  async function login(
    req: Request,
    input: { challengeId: string; response: AuthenticationResponseJSON },
    ctx: LoginContext,
  ): Promise<Result<IssuedSession>> {
    if (!auth.isProtected()) return { ok: false, error: "AUTH_NOT_CONFIGURED" };
    const wait = auth.internal.retryAfterSec(ctx.ip);
    if (wait > 0) return { ok: false, error: `AUTH_RATE_LIMITED:${wait}` };
    const o = webAuthnOrigin(req);
    if (!o) return { ok: false, error: "PASSKEY_UNSUPPORTED_ORIGIN" };

    const fail = (): Result<IssuedSession> => {
      auth.internal.recordFailure(ctx.ip);
      const next = auth.internal.retryAfterSec(ctx.ip);
      return { ok: false, error: next > 0 ? `AUTH_RATE_LIMITED:${next}` : "PASSKEY_INVALID" };
    };

    const c = challenges.take(input.challengeId, "login", o);
    if (!c) return { ok: false, error: "PASSKEY_CHALLENGE_INVALID" };
    const credId = input.response && typeof input.response.id === "string" ? input.response.id : "";
    const cred = store.getPasskeyByCredentialId(credId);
    // Passkey milik domain lain tidak boleh dipakai di sini.
    if (!cred || cred.rpId !== c.rpId) return fail();

    let verified: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
    try {
      verified = await verifyAuth({
        response: input.response,
        expectedChallenge: c.challenge,
        expectedOrigin: c.origin,
        expectedRPID: c.rpId,
        credential: {
          id: cred.credentialId,
          // Salin ke ArrayBuffer biasa (tipe `Uint8Array_` milik library).
          publicKey: new Uint8Array(cred.publicKey),
          counter: cred.counter,
          transports: cred.transports,
        },
        requireUserVerification: true,
      });
    } catch {
      return fail();
    }
    if (!verified.verified) return fail();
    auth.internal.recordSuccess(ctx.ip);
    store.markPasskeyUsed(cred.id, verified.authenticationInfo.newCounter, now());
    return { ok: true, data: auth.internal.issueSession(ctx) };
  }

  return { authenticationOptions, login };
}
