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
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { SessionStore } from "../../db";
import { type AvatarPresetId, isAvatarPresetId } from "../../lib/avatar-presets";
import type { AuthSessionRow, LockKind } from "../db/auth";
import type { Result } from "../result";

// ------------------------------------------------------------- konstanta ----

export const PIN_MIN = 6;
export const PIN_MAX = 12;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const NICKNAME_MAX = 40;
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_MIMES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
/** Pilihan kunci otomatis (menit); 0 = tidak pernah. */
export const AUTO_LOCK_CHOICES = [0, 5, 15, 30, 60] as const;
/** Umur maksimum sesi login (walau aktif terus). */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
/** Jangan tulis `last_seen_at` ke DB lebih sering dari ini per sesi. */
const TOUCH_THROTTLE_MS = 30_000;

/** Kegagalan beruntun sebelum penundaan mulai berlaku. */
const FREE_ATTEMPTS = 5;
/** Penundaan dasar setelah melewati FREE_ATTEMPTS; berlipat tiap gagal. */
const BASE_LOCKOUT_MS = 30_000;
const MAX_LOCKOUT_MS = 15 * 60_000;
/** Batas global lebih longgar (beberapa perangkat sah), tetap bertingkat. */
const GLOBAL_FREE_ATTEMPTS = 20;
/** Lupakan riwayat gagal setelah diam selama ini. */
const FAILURE_RESET_MS = 60 * 60_000;

export const SESSION_COOKIE = "kcg_session";

// ---------------------------------------------------------------- tipe ----

export interface AuthProfile {
  nickname: string | null;
  /** URL foto profil upload (dengan versi untuk cache-busting) atau null. */
  avatarUrl: string | null;
  /** Avatar bawaan (id preset) atau null. Eksklusif dengan `avatarUrl`. */
  avatarPreset: AvatarPresetId | null;
}

export interface AuthStatus {
  /** Kunci sudah diatur. */
  protected: boolean;
  /** Request ini membawa sesi yang valid (atau app belum dikunci). */
  authenticated: boolean;
  lockKind: LockKind | null;
  /** Panjang PIN tidak diekspos; hanya jenis kunci. */
  autoLockMinutes: number;
  profile: AuthProfile;
  /** Detik tersisa sebelum boleh mencoba lagi (anti brute-force). */
  retryAfterSec: number;
  /**
   * Instalasi baru yang belum menyelesaikan welcome screen. Hanya `true`
   * bila kunci BELUM diatur — begitu app dikunci, onboarding dianggap
   * selesai (pengunjung lewat tunnel tidak boleh melihat/menjalankannya).
   */
  needsOnboarding: boolean;
}

export interface LoginContext {
  ip: string;
  userAgent: string | null;
}

export interface IssuedSession {
  token: string;
  session: AuthSessionRow;
}

export interface DeviceInfo {
  id: string;
  userAgent: string | null;
  createdAt: number;
  lastSeenAt: number;
  current: boolean;
}

export interface AuthService {
  status(token: string | null, ip: string): AuthStatus;
  /** Validasi token; mengembalikan sesi & memperbarui aktivitasnya. */
  authenticate(token: string | null): AuthSessionRow | null;
  /**
   * Sesi (berdasarkan id) masih hidup? Dipakai WebSocket (hanya tahu id).
   * Dihitung sebagai aktivitas — memperpanjang batas kunci otomatis.
   */
  isSessionAlive(sessionId: string): boolean;
  /** Kunci diatur? Bila tidak, semua request diizinkan. */
  isProtected(): boolean;
  login(secret: string, ctx: LoginContext): Promise<Result<IssuedSession>>;
  logout(token: string | null): void;
  /**
   * Atur / ganti kunci. Bila kunci sudah ada, `current` wajib benar.
   * Semua sesi lain dicabut; pemanggil mendapat sesi baru.
   */
  setLock(
    input: { kind: LockKind; secret: string; current?: string },
    ctx: LoginContext,
  ): Promise<Result<IssuedSession>>;
  /** Hapus kunci (app kembali terbuka). Wajib sandi saat ini. */
  removeLock(current: string, ctx: LoginContext): Promise<Result<null>>;
  setNickname(nickname: string | null): Result<AuthProfile>;
  setAvatar(bytes: Uint8Array | null, mime: string | null): Result<AuthProfile>;
  /** Pakai avatar bawaan (menggantikan foto upload). */
  setAvatarPreset(preset: string): Result<AuthProfile>;
  getAvatar(): { bytes: Uint8Array; mime: string } | null;
  setAutoLock(minutes: number): Result<number>;
  /** Welcome screen selesai / dilewati (idempoten). */
  completeOnboarding(): void;
  listDevices(currentToken: string | null): DeviceInfo[];
  /** Cabut sesi lain (atau satu sesi tertentu). */
  revokeOthers(currentToken: string | null): void;
  revokeDevice(id: string): void;
  /** Dipanggil saat sesi dicabut / kedaluwarsa (mis. tutup WebSocket-nya). */
  onSessionEnded(cb: (sessionId: string) => void): () => void;
  /** Dipanggil setelah kunci diatur / diganti / dihapus (mis. matikan tunnel). */
  onLockChanged(cb: (protectedNow: boolean) => void): () => void;
  /** Bersihkan sesi kedaluwarsa & idle (dipanggil berkala). */
  sweep(): void;
  /** Reset total dari CLI: hapus kunci & semua sesi. */
  resetLock(): void;
  /**
   * Hook internal untuk modul passkey (`auth-passkeys.ts`) — memakai ulang
   * penerbitan sesi, verifikasi sandi, dan anti brute-force yang sama.
   */
  internal: {
    issueSession(ctx: LoginContext): IssuedSession;
    /** Verifikasi PIN/password saat ini (dengan rate limit). */
    checkCurrentSecret(secret: string, ip: string): Promise<Result<null>>;
    /** Detik tunggu anti brute-force; 0 = boleh mencoba. */
    retryAfterSec(ip: string): number;
    recordFailure(ip: string): void;
    recordSuccess(ip: string): void;
    findSessionId(token: string | null): string | null;
  };
}

export interface AuthServiceOptions {
  store: SessionStore;
  now?: () => number;
  /** Injeksi hash (test cepat). Default argon2id. */
  hash?: (secret: string) => Promise<string>;
  verify?: (secret: string, hash: string) => Promise<boolean>;
}

// ------------------------------------------------------------ util murni ----

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Validasi format kunci; kembalikan kode error atau null. */
export function validateSecret(kind: LockKind, secret: string): string | null {
  if (kind === "pin") {
    if (!/^\d+$/.test(secret)) return "PIN_DIGITS_ONLY";
    if (secret.length < PIN_MIN || secret.length > PIN_MAX) return "PIN_LENGTH";
    // Pola sangat mudah ditebak.
    if (/^(\d)\1+$/.test(secret)) return "PIN_TOO_SIMPLE";
    const asc = "01234567890123456789";
    const desc = "98765432109876543210";
    if (asc.includes(secret) || desc.includes(secret)) return "PIN_TOO_SIMPLE";
    return null;
  }
  if (secret.length < PASSWORD_MIN) return "PASSWORD_TOO_SHORT";
  if (secret.length > PASSWORD_MAX) return "PASSWORD_TOO_LONG";
  if (secret.trim().length === 0) return "PASSWORD_TOO_SHORT";
  return null;
}

/** Deteksi tipe gambar dari magic bytes (jangan percaya MIME dari client). */
export function sniffImageMime(bytes: Uint8Array): (typeof AVATAR_MIMES)[number] | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return "image/png";
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) {
    return "image/gif";
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/** Penundaan setelah `failures` gagal beruntun (0 bila masih bebas). */
export function lockoutMs(failures: number, free: number): number {
  if (failures < free) return 0;
  const steps = failures - free;
  return Math.min(MAX_LOCKOUT_MS, BASE_LOCKOUT_MS * 2 ** steps);
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// ------------------------------------------------------------- service ----

interface FailureState {
  count: number;
  lastAt: number;
  lockedUntil: number;
}

/** Hash dummy agar verifikasi tanpa kunci tetap memakan waktu yang sama. */
let dummyHashPromise: Promise<string> | null = null;

export function createAuthService(opts: AuthServiceOptions): AuthService {
  const store = opts.store;
  const now = opts.now ?? Date.now;
  const hash = opts.hash ?? ((s: string) => Bun.password.hash(s, { algorithm: "argon2id" }));
  const verify = opts.verify ?? ((s: string, h: string) => Bun.password.verify(s, h));
  const failures = new Map<string, FailureState>();
  const GLOBAL = "\u0000global";
  const lastTouch = new Map<string, number>();
  const endedListeners = new Set<(sessionId: string) => void>();
  const lockListeners = new Set<(protectedNow: boolean) => void>();

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

  function settings() {
    return store.getAuthSettings(now());
  }

  function profile(): AuthProfile {
    const s = settings();
    return {
      nickname: s.nickname,
      avatarUrl: s.avatarMime ? `/api/auth/avatar?v=${s.avatarVersion}` : null,
      // Preset yang tidak dikenal lagi (katalog berubah) diabaikan.
      avatarPreset: !s.avatarMime && isAvatarPresetId(s.avatarPreset) ? s.avatarPreset : null,
    };
  }

  function isProtected(): boolean {
    const s = settings();
    return s.lockKind !== null && s.lockHash !== null;
  }

  function ended(sessionId: string): void {
    lastTouch.delete(sessionId);
    for (const cb of endedListeners) cb(sessionId);
  }

  /** Sesi valid: belum kedaluwarsa dan belum melewati batas idle. */
  function isAlive(s: AuthSessionRow, t: number, autoLockMinutes: number): boolean {
    if (s.expiresAt <= t) return false;
    if (autoLockMinutes > 0 && t - s.lastSeenAt > autoLockMinutes * 60_000) return false;
    return true;
  }

  function findSession(token: string | null): AuthSessionRow | null {
    if (!token || token.length < 32 || token.length > 128) return null;
    const row = store.getAuthSessionByHash(hashToken(token));
    if (!row) return null;
    // Pembanding waktu-konstan (defensif; lookup DB sudah berdasarkan hash).
    if (!constantTimeEqual(row.tokenHash, hashToken(token))) return null;
    return row;
  }

  function authenticate(token: string | null): AuthSessionRow | null {
    const row = findSession(token);
    if (!row) return null;
    const t = now();
    if (!isAlive(row, t, settings().autoLockMinutes)) {
      store.deleteAuthSession(row.id);
      ended(row.id);
      return null;
    }
    const last = lastTouch.get(row.id) ?? row.lastSeenAt;
    if (t - last >= TOUCH_THROTTLE_MS) {
      store.touchAuthSession(row.id, t);
      lastTouch.set(row.id, t);
      row.lastSeenAt = t;
    }
    return row;
  }

  function isSessionAlive(sessionId: string): boolean {
    const row = store.getAuthSessionById(sessionId);
    if (!row) return false;
    const t = now();
    if (!isAlive(row, t, settings().autoLockMinutes)) {
      store.deleteAuthSession(row.id);
      ended(row.id);
      return false;
    }
    const last = lastTouch.get(row.id) ?? row.lastSeenAt;
    if (t - last >= TOUCH_THROTTLE_MS) {
      store.touchAuthSession(row.id, t);
      lastTouch.set(row.id, t);
    }
    return true;
  }

  function issue(ctx: LoginContext): IssuedSession {
    const token = randomBytes(32).toString("base64url");
    const t = now();
    const session: AuthSessionRow = {
      id: randomUUID(),
      tokenHash: hashToken(token),
      userAgent: ctx.userAgent ? ctx.userAgent.slice(0, 300) : null,
      createdAt: t,
      lastSeenAt: t,
      expiresAt: t + SESSION_TTL_MS,
    };
    store.insertAuthSession(session);
    lastTouch.set(session.id, t);
    return { token, session };
  }

  // ---- anti brute-force ----

  function failureOf(key: string): FailureState {
    const t = now();
    const f = failures.get(key);
    if (!f || t - f.lastAt > FAILURE_RESET_MS) return { count: 0, lastAt: t, lockedUntil: 0 };
    return f;
  }

  function retryAfterMs(ip: string): number {
    const t = now();
    return Math.max(0, failureOf(ip).lockedUntil - t, failureOf(GLOBAL).lockedUntil - t);
  }

  function recordFailure(ip: string): void {
    const t = now();
    for (const [key, free] of [
      [ip, FREE_ATTEMPTS],
      [GLOBAL, GLOBAL_FREE_ATTEMPTS],
    ] as const) {
      const f = failureOf(key);
      const count = f.count + 1;
      failures.set(key, { count, lastAt: t, lockedUntil: t + lockoutMs(count, free) });
    }
    // Batasi ukuran map (banyak IP berbeda).
    if (failures.size > 1000) {
      const oldest = [...failures.entries()].sort((a, b) => a[1].lastAt - b[1].lastAt)[0];
      if (oldest && oldest[0] !== GLOBAL) failures.delete(oldest[0]);
    }
  }

  function recordSuccess(ip: string): void {
    failures.delete(ip);
    // Global dikurangi, bukan dihapus: satu login sah tidak boleh membuka
    // jalan bagi penyerang yang sedang menebak dari IP lain.
    const g = failures.get(GLOBAL);
    if (g) failures.set(GLOBAL, { ...g, count: Math.max(0, g.count - FREE_ATTEMPTS) });
  }

  /** Verifikasi sandi dengan penundaan anti brute-force. */
  async function checkSecret(secret: string, ip: string): Promise<Result<null>> {
    const wait = retryAfterMs(ip);
    if (wait > 0) return { ok: false, error: `AUTH_RATE_LIMITED:${Math.ceil(wait / 1000)}` };
    const s = settings();
    if (typeof secret !== "string" || secret.length === 0 || secret.length > PASSWORD_MAX) {
      recordFailure(ip);
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
      recordFailure(ip);
      const next = retryAfterMs(ip);
      return {
        ok: false,
        error: next > 0 ? `AUTH_RATE_LIMITED:${Math.ceil(next / 1000)}` : "AUTH_INVALID",
      };
    }
    recordSuccess(ip);
    return { ok: true, data: null };
  }

  // ---- API ----

  function status(token: string | null, ip: string): AuthStatus {
    const s = settings();
    const prot = s.lockKind !== null && s.lockHash !== null;
    return {
      protected: prot,
      authenticated: !prot || authenticate(token) !== null,
      lockKind: prot ? s.lockKind : null,
      autoLockMinutes: s.autoLockMinutes,
      profile: profile(),
      retryAfterSec: Math.ceil(retryAfterMs(ip) / 1000),
      needsOnboarding: !prot && s.onboardedAt === null,
    };
  }

  async function login(secret: string, ctx: LoginContext): Promise<Result<IssuedSession>> {
    if (!isProtected()) return { ok: false, error: "AUTH_NOT_CONFIGURED" };
    const res = await checkSecret(secret, ctx.ip);
    if (!res.ok) return res;
    return { ok: true, data: issue(ctx) };
  }

  function logout(token: string | null): void {
    const row = findSession(token);
    if (row) {
      store.deleteAuthSession(row.id);
      ended(row.id);
    }
  }

  function revokeAllExcept(keepId: string | null): void {
    for (const s of store.listAuthSessions()) {
      if (s.id !== keepId) {
        store.deleteAuthSession(s.id);
        ended(s.id);
      }
    }
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
      if (!res.ok)
        return {
          ok: false,
          error: res.error === "AUTH_INVALID" ? "CURRENT_SECRET_INVALID" : res.error,
        };
    }
    const h = await hash(input.secret);
    store.setAuthLock(input.kind, h, now());
    // Kunci diatur = instalasi sudah dikonfigurasi.
    store.setAuthOnboarded(now());
    // Sandi berubah -> seluruh sesi lama tidak berlaku lagi.
    revokeAllExcept(null);
    lockChanged();
    return { ok: true, data: issue(ctx) };
  }

  async function removeLock(current: string, ctx: LoginContext): Promise<Result<null>> {
    if (!isProtected()) return { ok: true, data: null };
    const res = await checkSecret(current, ctx.ip);
    if (!res.ok)
      return {
        ok: false,
        error: res.error === "AUTH_INVALID" ? "CURRENT_SECRET_INVALID" : res.error,
      };
    store.setAuthLock(null, null, now());
    // Passkey hanya cara buka kunci TAMBAHAN — tanpa kunci, tidak berarti.
    store.deleteAllPasskeys();
    revokeAllExcept(null);
    lockChanged();
    return { ok: true, data: null };
  }

  function setNickname(nickname: string | null): Result<AuthProfile> {
    const clean = nickname === null ? null : nickname.replace(/\s+/g, " ").trim();
    if (clean !== null && clean.length > NICKNAME_MAX) {
      return { ok: false, error: "NICKNAME_TOO_LONG" };
    }
    // Karakter kontrol ditolak (nama tampil di lock screen).
    // biome-ignore lint/suspicious/noControlCharactersInRegex: memang menyaring kontrol
    if (clean !== null && /[\u0000-\u001f\u007f]/.test(clean)) {
      return { ok: false, error: "NICKNAME_INVALID" };
    }
    store.setAuthNickname(clean === "" ? null : clean, now());
    return { ok: true, data: profile() };
  }

  function setAvatar(bytes: Uint8Array | null, mime: string | null): Result<AuthProfile> {
    if (bytes === null) {
      store.setAuthAvatar(null, null, now());
      return { ok: true, data: profile() };
    }
    if (bytes.length === 0) return { ok: false, error: "EMPTY_UPLOAD" };
    if (bytes.length > AVATAR_MAX_BYTES) return { ok: false, error: "AVATAR_TOO_LARGE" };
    const sniffed = sniffImageMime(bytes);
    // Tipe berdasarkan isi file; MIME client hanya pelengkap.
    if (!sniffed || (mime !== null && mime !== "" && !AVATAR_MIMES.includes(mime as never))) {
      return { ok: false, error: "UNSUPPORTED_IMAGE_MIME" };
    }
    store.setAuthAvatar(bytes, sniffed, now());
    return { ok: true, data: profile() };
  }

  function setAvatarPreset(preset: string): Result<AuthProfile> {
    if (!isAvatarPresetId(preset)) return { ok: false, error: "AVATAR_PRESET_INVALID" };
    store.setAuthAvatarPreset(preset, now());
    return { ok: true, data: profile() };
  }

  function setAutoLock(minutes: number): Result<number> {
    if (!AUTO_LOCK_CHOICES.includes(minutes as never)) {
      return { ok: false, error: "AUTO_LOCK_INVALID" };
    }
    store.setAuthAutoLock(minutes, now());
    return { ok: true, data: minutes };
  }

  function listDevices(currentToken: string | null): DeviceInfo[] {
    const cur = findSession(currentToken);
    const t = now();
    const autoLock = settings().autoLockMinutes;
    return store
      .listAuthSessions()
      .filter((s) => isAlive(s, t, autoLock))
      .map((s) => ({
        id: s.id,
        userAgent: s.userAgent,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        current: s.id === cur?.id,
      }));
  }

  function revokeOthers(currentToken: string | null): void {
    revokeAllExcept(findSession(currentToken)?.id ?? null);
  }

  function revokeDevice(id: string): void {
    store.deleteAuthSession(id);
    ended(id);
  }

  function sweep(): void {
    const t = now();
    const autoLock = settings().autoLockMinutes;
    for (const s of store.listAuthSessions()) {
      if (!isAlive(s, t, autoLock)) {
        store.deleteAuthSession(s.id);
        ended(s.id);
      }
    }
  }

  function resetLock(): void {
    store.setAuthLock(null, null, now());
    store.deleteAllPasskeys();
    revokeAllExcept(null);
    lockChanged();
  }

  return {
    status,
    authenticate,
    isSessionAlive,
    isProtected,
    login,
    logout,
    setLock,
    removeLock,
    setNickname,
    setAvatar,
    setAvatarPreset,
    getAvatar: () => store.getAuthAvatar(),
    setAutoLock,
    completeOnboarding: () => store.setAuthOnboarded(now()),
    listDevices,
    revokeOthers,
    revokeDevice,
    onSessionEnded(cb) {
      endedListeners.add(cb);
      return () => endedListeners.delete(cb);
    },
    onLockChanged(cb) {
      lockListeners.add(cb);
      return () => lockListeners.delete(cb);
    },
    sweep,
    resetLock,
    internal: {
      issueSession: issue,
      async checkCurrentSecret(secret, ip) {
        const res = await checkSecret(secret, ip);
        if (res.ok) return res;
        return {
          ok: false,
          error: res.error === "AUTH_INVALID" ? "CURRENT_SECRET_INVALID" : res.error,
        };
      },
      retryAfterSec: (ip) => Math.ceil(retryAfterMs(ip) / 1000),
      recordFailure,
      recordSuccess,
      findSessionId: (token) => findSession(token)?.id ?? null,
    },
  };
}
