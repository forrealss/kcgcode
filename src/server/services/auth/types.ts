/**
 * Kontrak publik Auth_Service: konstanta kebijakan kunci, tipe data
 * (profil, status, sesi, perangkat), antarmuka `AuthService`, dan opsinya.
 */
import type { SessionStore } from "../../../db";
import type { AvatarPresetId } from "../../../lib/avatar-presets";
import type { AuthSessionRow, LockKind } from "../../db/auth";
import type { Result } from "../../result";

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
