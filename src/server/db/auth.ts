/**
 * Repository kunci aplikasi (lock screen): pengaturan tunggal (`auth_settings`,
 * id = 1) dan sesi login per perangkat (`auth_sessions`).
 *
 * Hanya hash yang disimpan: argon2id untuk sandi, SHA-256 untuk token sesi.
 * Passkey (`auth_passkeys`) hanya menyimpan kunci publik.
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
  /** Onboarding (welcome screen) selesai; null = instalasi baru. */
  onboardedAt: number | null;
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

export interface PasskeyRow {
  id: string;
  /** Credential ID WebAuthn (base64url). */
  credentialId: string;
  /** Kunci publik COSE. */
  publicKey: Uint8Array;
  counter: number;
  transports: string[];
  /** Domain tempat passkey didaftarkan. */
  rpId: string;
  name: string;
  /** `singleDevice` | `multiDevice` (tersinkron, mis. iCloud/Google). */
  deviceType: string | null;
  backedUp: boolean;
  createdAt: number;
  lastUsedAt: number | null;
}

interface PasskeyRowRaw {
  id: string;
  credential_id: string;
  public_key: Uint8Array;
  counter: number;
  transports: string | null;
  rp_id: string;
  name: string;
  device_type: string | null;
  backed_up: number;
  created_at: number;
  last_used_at: number | null;
}

function mapPasskey(r: PasskeyRowRaw): PasskeyRow {
  let transports: string[] = [];
  try {
    const parsed = r.transports ? JSON.parse(r.transports) : [];
    if (Array.isArray(parsed)) transports = parsed.filter((t) => typeof t === "string");
  } catch {
    // Kolom rusak -> tanpa hint transport (WebAuthn tetap jalan).
  }
  return {
    id: r.id,
    credentialId: r.credential_id,
    publicKey: new Uint8Array(r.public_key),
    counter: r.counter,
    transports,
    rpId: r.rp_id,
    name: r.name,
    deviceType: r.device_type,
    backedUp: r.backed_up === 1,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  };
}

interface SettingsRow {
  lock_kind: string | null;
  lock_hash: string | null;
  nickname: string | null;
  avatar_mime: string | null;
  avatar_preset: string | null;
  avatar_version: number;
  auto_lock_minutes: number;
  onboarded_at: number | null;
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
    onboardedAt: r.onboarded_at,
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
              auto_lock_minutes, onboarded_at, updated_at FROM auth_settings WHERE id = 1`,
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
    setOnboarded: db.query(
      "UPDATE auth_settings SET onboarded_at = ?, updated_at = ? WHERE id = 1 AND onboarded_at IS NULL",
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
    insertPasskey: db.query(
      `INSERT INTO auth_passkeys (id, credential_id, public_key, counter, transports, rp_id, name,
                                  device_type, backed_up, created_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    listPasskeys: db.query("SELECT * FROM auth_passkeys ORDER BY created_at ASC"),
    listPasskeysByRp: db.query(
      "SELECT * FROM auth_passkeys WHERE rp_id = ? ORDER BY created_at ASC",
    ),
    getPasskeyByCredential: db.query("SELECT * FROM auth_passkeys WHERE credential_id = ?"),
    getPasskeyById: db.query("SELECT * FROM auth_passkeys WHERE id = ?"),
    usePasskey: db.query("UPDATE auth_passkeys SET counter = ?, last_used_at = ? WHERE id = ?"),
    renamePasskey: db.query("UPDATE auth_passkeys SET name = ? WHERE id = ?"),
    deletePasskey: db.query("DELETE FROM auth_passkeys WHERE id = ?"),
    deleteAllPasskeys: db.query("DELETE FROM auth_passkeys"),
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
    /** Tandai onboarding selesai (idempoten: waktu pertama yang dipakai). */
    setAuthOnboarded(now: number): void {
      ensureSettings(now);
      q.setOnboarded.run(now, now);
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
    insertPasskey(p: PasskeyRow): void {
      q.insertPasskey.run(
        p.id,
        p.credentialId,
        p.publicKey,
        p.counter,
        JSON.stringify(p.transports),
        p.rpId,
        p.name,
        p.deviceType,
        p.backedUp ? 1 : 0,
        p.createdAt,
        p.lastUsedAt,
      );
    },
    listPasskeys(rpId?: string): PasskeyRow[] {
      const rows = (
        rpId === undefined ? q.listPasskeys.all() : q.listPasskeysByRp.all(rpId)
      ) as PasskeyRowRaw[];
      return rows.map(mapPasskey);
    },
    getPasskeyByCredentialId(credentialId: string): PasskeyRow | null {
      const row = q.getPasskeyByCredential.get(credentialId) as PasskeyRowRaw | null;
      return row ? mapPasskey(row) : null;
    },
    getPasskeyById(id: string): PasskeyRow | null {
      const row = q.getPasskeyById.get(id) as PasskeyRowRaw | null;
      return row ? mapPasskey(row) : null;
    },
    markPasskeyUsed(id: string, counter: number, now: number): void {
      q.usePasskey.run(counter, now, id);
    },
    renamePasskey(id: string, name: string): void {
      q.renamePasskey.run(name, id);
    },
    deletePasskey(id: string): void {
      q.deletePasskey.run(id);
    },
    deleteAllPasskeys(): void {
      q.deleteAllPasskeys.run();
    },
  };
}

export type AuthRepo = ReturnType<typeof createAuthRepo>;
