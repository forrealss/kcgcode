/**
 * Repository kunci aplikasi (lock screen): pengaturan tunggal (`auth_settings`,
 * id = 1) dan sesi login per perangkat (`auth_sessions`).
 *
 * Hanya hash yang disimpan: argon2id untuk sandi, SHA-256 untuk token sesi.
 */
import type { Database } from "bun:sqlite";

export type LockKind = "pin" | "password";

export interface AuthSettings {
  lockKind: LockKind | null;
  lockHash: string | null;
  nickname: string | null;
  avatarMime: string | null;
  /** Avatar bawaan (id preset) — null bila memakai foto / tanpa avatar. */
  avatarPreset: string | null;
  avatarVersion: number;
  autoLockMinutes: number;
  updatedAt: number;
}

export interface AuthSessionRow {
  id: string;
  tokenHash: string;
  userAgent: string | null;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
}

interface SettingsRow {
  lock_kind: string | null;
  lock_hash: string | null;
  nickname: string | null;
  avatar_mime: string | null;
  avatar_preset: string | null;
  avatar_version: number;
  auto_lock_minutes: number;
  updated_at: number;
}

interface SessionRowRaw {
  id: string;
  token_hash: string;
  user_agent: string | null;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
}

export const DEFAULT_AUTO_LOCK_MINUTES = 15;

function mapSettings(r: SettingsRow): AuthSettings {
  return {
    lockKind: r.lock_kind === "pin" || r.lock_kind === "password" ? r.lock_kind : null,
    lockHash: r.lock_hash,
    nickname: r.nickname,
    avatarMime: r.avatar_mime,
    avatarPreset: r.avatar_preset,
    avatarVersion: r.avatar_version,
    autoLockMinutes: r.auto_lock_minutes,
    updatedAt: r.updated_at,
  };
}

function mapSession(r: SessionRowRaw): AuthSessionRow {
  return {
    id: r.id,
    tokenHash: r.token_hash,
    userAgent: r.user_agent,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    expiresAt: r.expires_at,
  };
}

export function createAuthRepo(db: Database) {
  const q = {
    ensure: db.query(
      "INSERT OR IGNORE INTO auth_settings (id, auto_lock_minutes, updated_at) VALUES (1, ?, ?)",
    ),
    getSettings: db.query(
      `SELECT lock_kind, lock_hash, nickname, avatar_mime, avatar_preset, avatar_version,
              auto_lock_minutes, updated_at FROM auth_settings WHERE id = 1`,
    ),
    setLock: db.query(
      "UPDATE auth_settings SET lock_kind = ?, lock_hash = ?, updated_at = ? WHERE id = 1",
    ),
    setNickname: db.query("UPDATE auth_settings SET nickname = ?, updated_at = ? WHERE id = 1"),
    // Foto & preset saling eksklusif: mengatur satu menghapus yang lain.
    setAvatar: db.query(
      `UPDATE auth_settings SET avatar = ?, avatar_mime = ?, avatar_preset = NULL,
              avatar_version = avatar_version + 1, updated_at = ? WHERE id = 1`,
    ),
    setPreset: db.query(
      `UPDATE auth_settings SET avatar_preset = ?, avatar = NULL, avatar_mime = NULL,
              avatar_version = avatar_version + 1, updated_at = ? WHERE id = 1`,
    ),
    getAvatar: db.query("SELECT avatar, avatar_mime FROM auth_settings WHERE id = 1"),
    setAutoLock: db.query(
      "UPDATE auth_settings SET auto_lock_minutes = ?, updated_at = ? WHERE id = 1",
    ),
    insertSession: db.query(
      `INSERT INTO auth_sessions (id, token_hash, user_agent, created_at, last_seen_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ),
    getSessionByHash: db.query("SELECT * FROM auth_sessions WHERE token_hash = ?"),
    getSessionById: db.query("SELECT * FROM auth_sessions WHERE id = ?"),
    touchSession: db.query("UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?"),
    deleteSession: db.query("DELETE FROM auth_sessions WHERE id = ?"),
    deleteAllSessions: db.query("DELETE FROM auth_sessions"),
    deleteOtherSessions: db.query("DELETE FROM auth_sessions WHERE id <> ?"),
    listSessions: db.query("SELECT * FROM auth_sessions ORDER BY last_seen_at DESC"),
    deleteExpired: db.query("DELETE FROM auth_sessions WHERE expires_at <= ?"),
  };

  function ensureSettings(now: number): void {
    q.ensure.run(DEFAULT_AUTO_LOCK_MINUTES, now);
  }

  return {
    getAuthSettings(now: number): AuthSettings {
      ensureSettings(now);
      return mapSettings(q.getSettings.get() as SettingsRow);
    },
    setAuthLock(kind: LockKind | null, hash: string | null, now: number): void {
      ensureSettings(now);
      q.setLock.run(kind, hash, now);
    },
    setAuthNickname(nickname: string | null, now: number): void {
      ensureSettings(now);
      q.setNickname.run(nickname, now);
    },
    setAuthAvatar(bytes: Uint8Array | null, mime: string | null, now: number): void {
      ensureSettings(now);
      q.setAvatar.run(bytes, mime, now);
    },
    setAuthAvatarPreset(preset: string, now: number): void {
      ensureSettings(now);
      q.setPreset.run(preset, now);
    },
    getAuthAvatar(): { bytes: Uint8Array; mime: string } | null {
      const row = q.getAvatar.get() as {
        avatar: Uint8Array | null;
        avatar_mime: string | null;
      } | null;
      if (!row?.avatar || !row.avatar_mime) return null;
      return { bytes: row.avatar, mime: row.avatar_mime };
    },
    setAuthAutoLock(minutes: number, now: number): void {
      ensureSettings(now);
      q.setAutoLock.run(minutes, now);
    },
    insertAuthSession(s: AuthSessionRow): void {
      q.insertSession.run(s.id, s.tokenHash, s.userAgent, s.createdAt, s.lastSeenAt, s.expiresAt);
    },
    getAuthSessionByHash(tokenHash: string): AuthSessionRow | null {
      const row = q.getSessionByHash.get(tokenHash) as SessionRowRaw | null;
      return row ? mapSession(row) : null;
    },
    getAuthSessionById(id: string): AuthSessionRow | null {
      const row = q.getSessionById.get(id) as SessionRowRaw | null;
      return row ? mapSession(row) : null;
    },
    touchAuthSession(id: string, now: number): void {
      q.touchSession.run(now, id);
    },
    deleteAuthSession(id: string): void {
      q.deleteSession.run(id);
    },
    deleteAllAuthSessions(): void {
      q.deleteAllSessions.run();
    },
    deleteOtherAuthSessions(keepId: string): void {
      q.deleteOtherSessions.run(keepId);
    },
    listAuthSessions(): AuthSessionRow[] {
      return (q.listSessions.all() as SessionRowRaw[]).map(mapSession);
    },
    deleteExpiredAuthSessions(now: number): void {
      q.deleteExpired.run(now);
    },
  };
}

export type AuthRepo = ReturnType<typeof createAuthRepo>;
