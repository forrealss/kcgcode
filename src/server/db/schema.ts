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
  // Agent (mode) opencode pilihan Session — null = default opencode (build).
  ensureColumn(db, "sessions", "agent", "ALTER TABLE sessions ADD COLUMN agent TEXT");
  // Model pilihan per Session (JSON `{providerID, modelID}`), NULL = default.
  ensureColumn(db, "sessions", "model", "ALTER TABLE sessions ADD COLUMN model TEXT");
}
