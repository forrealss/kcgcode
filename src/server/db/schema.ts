/**
 * Skema SQLite & migrasi idempoten untuk `Session_Store` (headless).
 * Dipisah dari `db.ts` agar komposisi root tetap ramping dan evolusi skema
 * (menambah tabel/kolom) punya satu tempat.
 */
import type { Database } from "bun:sqlite";

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  path TEXT NOT NULL UNIQUE,
  instructions TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  agent_type TEXT NOT NULL,
  cwd TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','stopped','crashed')),
  oc_session_id TEXT,
  model TEXT,
  agent TEXT,
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Append-only: tidak pernah UPDATE/DELETE, hanya INSERT (Requirement 3.3)
CREATE TABLE IF NOT EXISTS session_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  status TEXT NOT NULL,
  changed_at INTEGER NOT NULL
);

-- Append-only: pesan percakapan terstruktur (Requirement 3.1, 3.2)
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  message_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  parts_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(session_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_messages_session_created ON messages(session_id, created_at);

CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  kind TEXT NOT NULL DEFAULT 'permission',
  type TEXT NOT NULL CHECK (type IN ('confirmation','menu')),
  custom INTEGER NOT NULL DEFAULT 0,
  title TEXT,
  options_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','resolved')),
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_prompts_session_status ON prompts(session_id, status);

-- Kunci aplikasi (lock screen). Satu baris (id = 1). Hash argon2id — sandi
-- asli tidak pernah disimpan. lock_kind NULL = kunci belum diatur.
CREATE TABLE IF NOT EXISTS auth_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  lock_kind TEXT CHECK (lock_kind IN ('pin','password')),
  lock_hash TEXT,
  nickname TEXT,
  avatar_mime TEXT,
  avatar BLOB,
  avatar_preset TEXT,
  avatar_version INTEGER NOT NULL DEFAULT 0,
  auto_lock_minutes INTEGER NOT NULL DEFAULT 15,
  updated_at INTEGER NOT NULL
);

-- Sesi login per perangkat. Yang disimpan hanya SHA-256 dari token cookie,
-- sehingga bocornya DB tidak memberi sesi yang bisa dipakai.
CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Passkey (WebAuthn) — cara buka kunci TAMBAHAN di samping PIN/password.
-- Hanya kunci publik yang disimpan (bukan rahasia). rp_id = domain tempat
-- passkey didaftarkan; passkey hanya berlaku di domain yang sama.
CREATE TABLE IF NOT EXISTS auth_passkeys (
  id TEXT PRIMARY KEY,
  credential_id TEXT NOT NULL UNIQUE,
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  rp_id TEXT NOT NULL,
  name TEXT NOT NULL,
  device_type TEXT,
  backed_up INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_auth_passkeys_rp ON auth_passkeys(rp_id);

-- Tunnel publik (<username>.<domain>) lewat API kcgcode-rp + frpc.
-- Satu baris (id = 1). device_token (dari device flow, bisa dicabut di VPS)
-- & tunnel_secret tidak pernah dikirim ke browser; enabled = tunnel
-- dinyalakan ulang saat start.
CREATE TABLE IF NOT EXISTS tunnel_account (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  email TEXT,
  username TEXT,
  subdomain TEXT,
  device_id TEXT,
  device_token TEXT,
  tunnel_secret TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
`;

/** Menambah kolom bila belum ada (migrasi DB lama yang idempoten). */
function ensureColumn(db: Database, table: string, column: string, ddl: string): void {
  const cols = db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(ddl);
}

/**
 * Menjalankan seluruh migrasi idempoten: membuat tabel yang belum ada lalu
 * menambah kolom dari skema lama (versi PTY) yang masih dipakai.
 */
export function runMigrations(db: Database): void {
  db.exec(SCHEMA);
  ensureColumn(
    db,
    "sessions",
    "oc_session_id",
    "ALTER TABLE sessions ADD COLUMN oc_session_id TEXT",
  );
  ensureColumn(
    db,
    "prompts",
    "kind",
    "ALTER TABLE prompts ADD COLUMN kind TEXT NOT NULL DEFAULT 'permission'",
  );
  ensureColumn(db, "prompts", "title", "ALTER TABLE prompts ADD COLUMN title TEXT");
  // Question saja: boleh jawab bebas (flag `custom` skema question opencode).
  ensureColumn(
    db,
    "prompts",
    "custom",
    "ALTER TABLE prompts ADD COLUMN custom INTEGER NOT NULL DEFAULT 0",
  );
  // Question saja: boleh pilih lebih dari satu opsi (flag `multiple` skema
  // question opencode) — kartu history tetap tampil sebagai multi-select.
  ensureColumn(
    db,
    "prompts",
    "multiple",
    "ALTER TABLE prompts ADD COLUMN multiple INTEGER NOT NULL DEFAULT 0",
  );
  // Multi-question: JSON seluruh pertanyaan request (null = pertanyaan
  // tunggal, field legacy title/options cukup).
  ensureColumn(
    db,
    "prompts",
    "questions_json",
    "ALTER TABLE prompts ADD COLUMN questions_json TEXT",
  );
  // Agent (mode) opencode pilihan Session — null = default opencode (build).
  ensureColumn(db, "sessions", "agent", "ALTER TABLE sessions ADD COLUMN agent TEXT");
  // Model pilihan per Session (JSON `{providerID, modelID}`), NULL = default.
  ensureColumn(db, "sessions", "model", "ALTER TABLE sessions ADD COLUMN model TEXT");
  // Judul Session hasil generate opencode (SSE `session.updated`), NULL = belum ada.
  ensureColumn(db, "sessions", "title", "ALTER TABLE sessions ADD COLUMN title TEXT");
  // Custom instruction per Project (dikirim sebagai `system`), NULL = tidak ada.
  ensureColumn(db, "projects", "instructions", "ALTER TABLE projects ADD COLUMN instructions TEXT");
  // Remote access: provider terpilih (kcg = layanan bawaan, lhr = localhost.run)
  // + status nyala localhost.run (dinyalakan ulang otomatis saat start).
  ensureColumn(
    db,
    "tunnel_account",
    "provider",
    "ALTER TABLE tunnel_account ADD COLUMN provider TEXT NOT NULL DEFAULT 'kcg'",
  );
  ensureColumn(
    db,
    "tunnel_account",
    "lhr_enabled",
    "ALTER TABLE tunnel_account ADD COLUMN lhr_enabled INTEGER NOT NULL DEFAULT 0",
  );
  // Avatar bawaan (id preset ikon). Eksklusif dengan foto upload `avatar`.
  ensureColumn(
    db,
    "auth_settings",
    "avatar_preset",
    "ALTER TABLE auth_settings ADD COLUMN avatar_preset TEXT",
  );
  // Onboarding (welcome screen) selesai — NULL = instalasi baru.
  const hadOnboarded = (
    db.query("PRAGMA table_info(auth_settings)").all() as { name: string }[]
  ).some((c) => c.name === "onboarded_at");
  ensureColumn(
    db,
    "auth_settings",
    "onboarded_at",
    "ALTER TABLE auth_settings ADD COLUMN onboarded_at INTEGER",
  );
  if (!hadOnboarded) {
    // Instalasi LAMA (sudah punya kunci / profil / project sebelum fitur ini)
    // tidak perlu melihat welcome screen — tandai selesai saat migrasi.
    db.exec(`UPDATE auth_settings SET onboarded_at = updated_at
             WHERE onboarded_at IS NULL
               AND (lock_kind IS NOT NULL OR nickname IS NOT NULL
                    OR EXISTS (SELECT 1 FROM projects))`);
  }
}
