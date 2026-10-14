/**
 * Auth_Service — kunci aplikasi (lock screen) untuk akses lewat tunnel.
 *
 * Model: satu pemilik, satu kunci (PIN angka atau password). Tidak ada akun.
 * - Sandi disimpan sebagai hash argon2id (`Bun.password`).
 * - Login membuat sesi per perangkat: token acak 256-bit di cookie
 *   HttpOnly; DB hanya menyimpan SHA-256 token.
 * - Kunci otomatis ditegakkan server: sesi yang tidak aktif lebih lama dari
 *   `autoLockMinutes` dianggap terkunci (bukan sekadar UI).
 * - Anti brute-force: penundaan bertingkat per IP DAN global (tunnel sering
 *   menyamarkan IP asli, jadi batas global tetap melindungi).
 * - Kunci belum diatur -> app terbuka (`protected: false`) dan UI
 *   menampilkan peringatan; begitu diatur, perangkat pengatur langsung login.
 *
 * Bagian yang berdiri sendiri ada di `./auth/`: kontrak publik & konstanta
 * (`types`), util murni hash/validasi (`validation`), anti brute-force
 * (`lockout`), verifikasi sandi saat ini (`secret-check`), sesi per
 * perangkat (`sessions`), serta profil & preferensi (`profile`).
 */
import type { LockKind } from "../db/auth";
import type { Result } from "../result";
import { FailureTracker } from "./auth/lockout";
import { createProfileOps } from "./auth/profile";
import { createSecretChecker, currentSecretError } from "./auth/secret-check";
import { AuthSessions } from "./auth/sessions";
import type {
  AuthService,
  AuthServiceOptions,
  AuthStatus,
  IssuedSession,
  LoginContext,
} from "./auth/types";
import { validateSecret } from "./auth/validation";

export { lockoutMs } from "./auth/lockout";
export {
  AUTO_LOCK_CHOICES,
  type AuthProfile,
  type AuthService,
  type AuthServiceOptions,
  type AuthStatus,
  AVATAR_MAX_BYTES,
  AVATAR_MIMES,
  type DeviceInfo,
  type IssuedSession,
  type LoginContext,
  NICKNAME_MAX,
  PASSWORD_MAX,
  PASSWORD_MIN,
  PIN_MAX,
  PIN_MIN,
  SESSION_COOKIE,
  SESSION_TTL_MS,
} from "./auth/types";
export { hashToken, sniffImageMime, validateSecret } from "./auth/validation";

export function createAuthService(opts: AuthServiceOptions): AuthService {
  const store = opts.store;
  const now = opts.now ?? Date.now;
  const hash = opts.hash ?? ((s: string) => Bun.password.hash(s, { algorithm: "argon2id" }));
  const verify = opts.verify ?? ((s: string, h: string) => Bun.password.verify(s, h));
  const lockListeners = new Set<(protectedNow: boolean) => void>();

  function settings() {
    return store.getAuthSettings(now());
  }

  const failures = new FailureTracker(now);
  const checkSecret = createSecretChecker({ failures, settings, hash, verify });
  const sessions = new AuthSessions({
    store,
    now,
    autoLockMinutes: () => settings().autoLockMinutes,
  });
  const profileOps = createProfileOps({ store, now, settings });

  function lockChanged(): void {
    const prot = isProtected();
    for (const cb of lockListeners) {
      try {
        cb(prot);
      } catch (e) {
        console.error("[kcg-code] lock listener gagal:", e);
      }
    }
  }

  function isProtected(): boolean {
    const s = settings();
    return s.lockKind !== null && s.lockHash !== null;
  }

  // ---- API ----

  function status(token: string | null, ip: string): AuthStatus {
    const s = settings();
    const prot = s.lockKind !== null && s.lockHash !== null;
    return {
      protected: prot,
      authenticated: !prot || sessions.authenticate(token) !== null,
      lockKind: prot ? s.lockKind : null,
      autoLockMinutes: s.autoLockMinutes,
      profile: profileOps.profile(),
      retryAfterSec: Math.ceil(failures.retryAfterMs(ip) / 1000),
      needsOnboarding: !prot && s.onboardedAt === null,
    };
  }

  async function login(secret: string, ctx: LoginContext): Promise<Result<IssuedSession>> {
    if (!isProtected()) return { ok: false, error: "AUTH_NOT_CONFIGURED" };
    const res = await checkSecret(secret, ctx.ip);
    if (!res.ok) return res;
    return { ok: true, data: sessions.issue(ctx) };
  }

  async function setLock(
    input: { kind: LockKind; secret: string; current?: string },
    ctx: LoginContext,
  ): Promise<Result<IssuedSession>> {
    if (input.kind !== "pin" && input.kind !== "password") {
      return { ok: false, error: "LOCK_KIND_INVALID" };
    }
    const invalid = validateSecret(input.kind, input.secret);
    if (invalid) return { ok: false, error: invalid };
    if (isProtected()) {
      const res = await checkSecret(input.current ?? "", ctx.ip);
      if (!res.ok) return { ok: false, error: currentSecretError(res.error) };
    }
    const h = await hash(input.secret);
    store.setAuthLock(input.kind, h, now());
    // Kunci diatur = instalasi sudah dikonfigurasi.
    store.setAuthOnboarded(now());
    // Sandi berubah -> seluruh sesi lama tidak berlaku lagi.
    sessions.revokeAllExcept(null);
    lockChanged();
    return { ok: true, data: sessions.issue(ctx) };
  }

  async function removeLock(current: string, ctx: LoginContext): Promise<Result<null>> {
    if (!isProtected()) return { ok: true, data: null };
    const res = await checkSecret(current, ctx.ip);
    if (!res.ok) return { ok: false, error: currentSecretError(res.error) };
    store.setAuthLock(null, null, now());
    // Passkey hanya cara buka kunci TAMBAHAN — tanpa kunci, tidak berarti.
    store.deleteAllPasskeys();
    sessions.revokeAllExcept(null);
    lockChanged();
    return { ok: true, data: null };
  }

  function resetLock(): void {
    store.setAuthLock(null, null, now());
    store.deleteAllPasskeys();
    sessions.revokeAllExcept(null);
    lockChanged();
  }

  return {
    status,
    authenticate: (token) => sessions.authenticate(token),
    isSessionAlive: (sessionId) => sessions.isSessionAlive(sessionId),
    isProtected,
    login,
    logout: (token) => sessions.logout(token),
    setLock,
    removeLock,
    setNickname: profileOps.setNickname,
    setAvatar: profileOps.setAvatar,
    setAvatarPreset: profileOps.setAvatarPreset,
    getAvatar: () => store.getAuthAvatar(),
    setAutoLock: profileOps.setAutoLock,
    completeOnboarding: () => store.setAuthOnboarded(now()),
    listDevices: (currentToken) => sessions.listDevices(currentToken),
    revokeOthers: (currentToken) =>
      sessions.revokeAllExcept(sessions.find(currentToken)?.id ?? null),
    revokeDevice: (id) => sessions.revoke(id),
    onSessionEnded: (cb) => sessions.onEnded(cb),
    onLockChanged(cb) {
      lockListeners.add(cb);
      return () => lockListeners.delete(cb);
    },
    sweep: () => sessions.sweep(),
    resetLock,
    internal: {
      issueSession: (ctx) => sessions.issue(ctx),
      async checkCurrentSecret(secret, ip) {
        const res = await checkSecret(secret, ip);
        if (res.ok) return res;
        return { ok: false, error: currentSecretError(res.error) };
      },
      retryAfterSec: (ip) => Math.ceil(failures.retryAfterMs(ip) / 1000),
      recordFailure: (ip) => failures.recordFailure(ip),
      recordSuccess: (ip) => failures.recordSuccess(ip),
      findSessionId: (token) => sessions.find(token)?.id ?? null,
    },
  };
}
