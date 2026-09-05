/**
 * Session_Store — persistensi `bun:sqlite`.
 * Sesuai `design.md` — skema SQLite & `db.ts` (versi headless).
 *
 * Perubahan dari versi PTY/TUI:
 * - `output_stream` (chunk byte TUI) digantikan tabel `messages` berisi
 *   pesan terstruktur (role + parts JSON).
 * - `sessions.oc_session_id` menyimpan id Session di server headless opencode.
 * - `prompts` mendapat kolom `kind` (permission/question) dan `title`.
 *
 * Konvensi: `session_status_history` dan `messages` bersifat **append-only**
 * (insert-only) sehingga Requirement 3.1/3.3 terpenuhi secara struktural.
 * Seluruh operasi tulis dibungkus try/catch; kegagalan mengembalikan
 * `{ ok: false, error }` tanpa menghapus data lama (Requirement 3.2).
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Result, SimpleResult } from "./server/result";
import type {
  InteractivePrompt,
  MessagePart,
  Project,
  PromptStatus,
  Session,
  SessionMessage,
  SessionModel,
  SessionStatus,
} from "./types";

export const DEFAULT_DB_PATH = "data/kcg-code.sqlite";

/** Satu entri riwayat status (append-only). */
export interface StatusHistoryEntry {
  sessionId: string;
  status: SessionStatus;
  changedAt: number;
}

const SCHEMA = `
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

export interface SessionStore {
  // ---- Pesan terstruktur (append-only) ----
  insertMessage(message: SessionMessage): Result<SessionMessage>;
  getMessages(sessionId: string): Result<SessionMessage[]>;

  // ---- Riwayat status (append-only) ----
  insertStatusHistory(
    sessionId: string,
    status: SessionStatus,
    changedAt?: number,
  ): Result<StatusHistoryEntry>;
  getStatusHistory(sessionId: string): Result<StatusHistoryEntry[]>;

  // ---- Sessions (CRUD) ----
  insertSession(session: Session): Result<Session>;
  updateSessionStatus(
    sessionId: string,
    status: SessionStatus,
    changedAt?: number,
  ): Result<Session>;
  /** Perbarui ocSessionId tanpa mengubah status (dipakai resumeSession). */
  updateSessionOcId(sessionId: string, ocSessionId: string | null): Result<Session>;
  /** Perbarui model pilihan Session; `null` = kembali ke default opencode. */
  updateSessionModel(sessionId: string, model: SessionModel | null): Result<Session>;
  /** Perbarui agent (mode) pilihan Session; `null` = default opencode. */
  updateSessionAgent(sessionId: string, agent: string | null): Result<Session>;
  getSession(sessionId: string): Result<Session>;
  getSessionByOcId(ocSessionId: string): Result<Session>;
  listSessions(): Session[];
  /**
   * Hapus Session beserta seluruh baris anaknya (messages, prompts,
   * status history) dalam satu transaksi. `ok: false` bila tidak ada.
   */
  deleteSession(sessionId: string): SimpleResult;

  // ---- Projects (CRUD) ----
  insertProject(project: Project): Result<Project>;
  getProjectById(id: string): Result<Project>;
  getProjectByName(name: string): Result<Project>;
  getProjectByPath(filePath: string): Result<Project>;
  listProjects(): Project[];
  /** Session milik satu Project (dipakai sebelum menghapus Project). */
  listProjectSessions(projectId: string): Session[];
  /**
   * Hapus baris Project. Menolak (`PROJECT_HAS_SESSIONS`) bila masih ada
   * Session yang menunjuk Project ini — Session harus dihapus lebih dulu
   * lewat `SessionManager.deleteSession` agar sesi remote opencode dan
   * lampirannya ikut dibersihkan, bukan ditinggal yatim.
   */
  deleteProject(projectId: string): SimpleResult;

  // ---- Prompts (CRUD) ----
  insertPrompt(prompt: InteractivePrompt): Result<InteractivePrompt>;
  getPrompt(promptId: string): Result<InteractivePrompt>;
  listPendingPrompts(sessionId: string): InteractivePrompt[];
  updatePromptStatus(
    promptId: string,
    status: PromptStatus,
    resolvedAt?: number,
  ): Result<InteractivePrompt>;

  close(): void;
}

interface ProjectRow {
  id: string;
  name: string;
  path: string;
  created_at: number;
}

interface SessionRow {
  id: string;
  project_id: string;
  agent_type: string;
  cwd: string;
  status: string;
  oc_session_id: string | null;
  model: string | null;
  agent: string | null;
  created_at: number;
  updated_at: number;
}

interface PromptRow {
  id: string;
  session_id: string;
  kind: string;
  type: string;
  custom: number;
  title: string | null;
  options_json: string | null;
  status: string;
  created_at: number;
  resolved_at: number | null;
}

interface MessageRow {
  session_id: string;
  message_id: string;
  role: string;
  parts_json: string;
  created_at: number;
}

function mapProject(r: ProjectRow): Project {
  return { id: r.id, name: r.name, path: r.path, createdAt: r.created_at };
}

/**
 * Parse kolom `sessions.model` (JSON) -> SessionModel.
 * Nilai NULL/korup/tidak lengkap dianggap "pakai model default" (null).
 */
function parseModel(raw: string | null): SessionModel | null {
  if (raw === null || raw === "") return null;
  try {
    const obj = JSON.parse(raw) as { providerID?: unknown; modelID?: unknown } | null;
    if (obj && typeof obj.providerID === "string" && typeof obj.modelID === "string") {
      return { providerID: obj.providerID, modelID: obj.modelID };
    }
  } catch {
    /* data korup -> default */
  }
  return null;
}

function mapSession(r: SessionRow): Session {
  return {
    id: r.id,
    projectId: r.project_id,
    agentType: r.agent_type as Session["agentType"],
    cwd: r.cwd,
    status: r.status as SessionStatus,
    ocSessionId: r.oc_session_id,
    model: parseModel(r.model),
    agent: r.agent ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapPrompt(r: PromptRow): InteractivePrompt {
  return {
    id: r.id,
    sessionId: r.session_id,
    kind: (r.kind as InteractivePrompt["kind"]) ?? "permission",
    type: r.type as InteractivePrompt["type"],
    custom: r.custom === 1,
    title: r.title,
    options: r.options_json ? (JSON.parse(r.options_json) as string[]) : null,
    status: r.status as PromptStatus,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
  };
}

function mapMessage(r: MessageRow): SessionMessage {
  return {
    id: r.message_id,
    sessionId: r.session_id,
    role: r.role as SessionMessage["role"],
    parts: JSON.parse(r.parts_json) as MessagePart[],
    createdAt: r.created_at,
  };
}

function errResult(msg: string): { ok: false; error: string } {
  return { ok: false, error: msg };
}

/**
 * Membuka koneksi ke database, menyalakan WAL, dan menjalankan migrasi
 * idempoten. Default `data/kcg-code.sqlite`.
 */
export function openSessionStore(dbPath: string = DEFAULT_DB_PATH): SessionStore {
  if (dbPath !== ":memory:") {
    mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
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

  // Prepared statements
  const q = {
    sessionExists: db.query("SELECT id FROM sessions WHERE id = ?"),
    insertProject: db.query(
      "INSERT INTO projects (id, name, path, created_at) VALUES (?, ?, ?, ?)",
    ),
    getProjectById: db.query("SELECT * FROM projects WHERE id = ?"),
    getProjectByName: db.query("SELECT * FROM projects WHERE name = ?"),
    getProjectByPath: db.query("SELECT * FROM projects WHERE path = ?"),
    listProjects: db.query("SELECT * FROM projects ORDER BY created_at ASC, name ASC"),
    listProjectSessions: db.query(
      "SELECT * FROM sessions WHERE project_id = ? ORDER BY created_at ASC, id ASC",
    ),
    deleteProjectRow: db.query("DELETE FROM projects WHERE id = ?"),

    insertSession: db.query(
      "INSERT INTO sessions (id, project_id, agent_type, cwd, status, oc_session_id, model, agent, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ),
    getSession: db.query("SELECT * FROM sessions WHERE id = ?"),
    getSessionByOcId: db.query("SELECT * FROM sessions WHERE oc_session_id = ?"),
    listSessions: db.query("SELECT * FROM sessions ORDER BY created_at ASC, id ASC"),
    updateSession: db.query("UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?"),
    updateSessionOcId: db.query(
      "UPDATE sessions SET oc_session_id = ?, updated_at = ? WHERE id = ?",
    ),
    updateSessionModel: db.query("UPDATE sessions SET model = ?, updated_at = ? WHERE id = ?"),
    updateSessionAgent: db.query("UPDATE sessions SET agent = ?, updated_at = ? WHERE id = ?"),
    deleteSessionMessages: db.query("DELETE FROM messages WHERE session_id = ?"),
    deleteSessionPrompts: db.query("DELETE FROM prompts WHERE session_id = ?"),
    deleteSessionHistory: db.query("DELETE FROM session_status_history WHERE session_id = ?"),
    deleteSessionRow: db.query("DELETE FROM sessions WHERE id = ?"),

    insertMessage: db.query(
      "INSERT INTO messages (session_id, message_id, role, parts_json, created_at) VALUES (?, ?, ?, ?, ?)",
    ),
    getMessages: db.query(
      "SELECT session_id, message_id, role, parts_json, created_at FROM messages WHERE session_id = ? ORDER BY created_at ASC, id ASC",
    ),

    insertHistory: db.query(
      "INSERT INTO session_status_history (session_id, status, changed_at) VALUES (?, ?, ?)",
    ),
    getHistory: db.query(
      "SELECT session_id, status, changed_at FROM session_status_history WHERE session_id = ? ORDER BY id ASC",
    ),

    insertPrompt: db.query(
      "INSERT INTO prompts (id, session_id, kind, type, custom, title, options_json, status, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ),
    getPrompt: db.query("SELECT * FROM prompts WHERE id = ?"),
    pendingPrompts: db.query(
      "SELECT * FROM prompts WHERE session_id = ? AND status = 'pending' ORDER BY created_at ASC, id ASC",
    ),
    updatePrompt: db.query("UPDATE prompts SET status = ?, resolved_at = ? WHERE id = ?"),
  };

  const store: SessionStore = {
    // ---------------- Pesan terstruktur (append-only) ----------------
    insertMessage(message: SessionMessage): Result<SessionMessage> {
      try {
        if (!q.sessionExists.get(message.sessionId)) return errResult("SESSION_NOT_FOUND");
        q.insertMessage.run(
          message.sessionId,
          message.id,
          message.role,
          JSON.stringify(message.parts),
          message.createdAt,
        );
        return { ok: true, data: message };
      } catch (e) {
        return errResult(`MESSAGE_WRITE_FAILED: ${(e as Error).message}`);
      }
    },

    getMessages(sessionId: string): Result<SessionMessage[]> {
      try {
        if (!q.sessionExists.get(sessionId)) return errResult("SESSION_NOT_FOUND");
        const rows = q.getMessages.all(sessionId) as MessageRow[];
        return { ok: true, data: rows.map(mapMessage) };
      } catch (e) {
        return errResult(`MESSAGE_READ_FAILED: ${(e as Error).message}`);
      }
    },

    // ---------------- Riwayat status (append-only) ----------------
    insertStatusHistory(sessionId, status, changedAt = Date.now()): Result<StatusHistoryEntry> {
      try {
        if (!q.sessionExists.get(sessionId)) return errResult("SESSION_NOT_FOUND");
        q.insertHistory.run(sessionId, status, changedAt);
        return { ok: true, data: { sessionId, status, changedAt } };
      } catch (e) {
        return errResult(`HISTORY_WRITE_FAILED: ${(e as Error).message}`);
      }
    },

    getStatusHistory(sessionId: string): Result<StatusHistoryEntry[]> {
      try {
        if (!q.sessionExists.get(sessionId)) return errResult("SESSION_NOT_FOUND");
        const rows = q.getHistory.all(sessionId) as {
          session_id: string;
          status: string;
          changed_at: number;
        }[];
        return {
          ok: true,
          data: rows.map((r) => ({
            sessionId: r.session_id,
            status: r.status as SessionStatus,
            changedAt: r.changed_at,
          })),
        };
      } catch (e) {
        return errResult(`HISTORY_READ_FAILED: ${(e as Error).message}`);
      }
    },

    // ---------------- Sessions (CRUD) ----------------
    insertSession(session: Session): Result<Session> {
      try {
        const project = q.getProjectById.get(session.projectId);
        if (!project) return errResult("PROJECT_NOT_FOUND");
        q.insertSession.run(
          session.id,
          session.projectId,
          session.agentType,
          session.cwd,
          session.status,
          session.ocSessionId,
          session.model ? JSON.stringify(session.model) : null,
          session.agent ?? null,
          session.createdAt,
          session.updatedAt,
        );
        return { ok: true, data: session };
      } catch (e) {
        return errResult(`SESSION_WRITE_FAILED: ${(e as Error).message}`);
      }
    },

    updateSessionStatus(sessionId, status, changedAt = Date.now()): Result<Session> {
      try {
        const existing = q.getSession.get(sessionId) as SessionRow | null;
        if (!existing) return errResult("SESSION_NOT_FOUND");
        const tx = db.transaction(() => {
          q.updateSession.run(status, changedAt, sessionId);
          q.insertHistory.run(sessionId, status, changedAt);
        });
        tx();
        const updated = mapSession(q.getSession.get(sessionId) as SessionRow);
        return { ok: true, data: updated };
      } catch (e) {
        return errResult(`SESSION_UPDATE_FAILED: ${(e as Error).message}`);
      }
    },

    /**
     * Perbarui `oc_session_id` tanpa mengubah status — dipakai `resumeSession`
     * saat Session lama menunjuk oc session yang sudah tidak dikenal server
     * (mis. storage opencode dibersihkan) dan perlu memakai sesi remote baru.
     */
    updateSessionOcId(sessionId: string, ocSessionId: string | null): Result<Session> {
      try {
        const existing = q.getSession.get(sessionId) as SessionRow | null;
        if (!existing) return errResult("SESSION_NOT_FOUND");
        q.updateSessionOcId.run(ocSessionId, Date.now(), sessionId);
        const updated = mapSession(q.getSession.get(sessionId) as SessionRow);
        return { ok: true, data: updated };
      } catch (e) {
        return errResult(`SESSION_UPDATE_FAILED: ${(e as Error).message}`);
      }
    },

    /**
     * Perbarui model pilihan Session tanpa mengubah status — dipakai rute
     * `PUT /api/sessions/:id/model`. `null` berarti kembali ke default opencode.
     */
    updateSessionModel(sessionId: string, model: SessionModel | null): Result<Session> {
      try {
        const existing = q.getSession.get(sessionId) as SessionRow | null;
        if (!existing) return errResult("SESSION_NOT_FOUND");
        q.updateSessionModel.run(model ? JSON.stringify(model) : null, Date.now(), sessionId);
        const updated = mapSession(q.getSession.get(sessionId) as SessionRow);
        return { ok: true, data: updated };
      } catch (e) {
        return errResult(`SESSION_UPDATE_FAILED: ${(e as Error).message}`);
      }
    },

    /**
     * Perbarui agent (mode) pilihan Session tanpa mengubah status — dipakai
     * rute `PUT /api/sessions/:id`. `null` berarti kembali ke agent default
     * opencode (biasanya `build`).
     */
    updateSessionAgent(sessionId: string, agent: string | null): Result<Session> {
      try {
        const existing = q.getSession.get(sessionId) as SessionRow | null;
        if (!existing) return errResult("SESSION_NOT_FOUND");
        q.updateSessionAgent.run(agent ?? null, Date.now(), sessionId);
        const updated = mapSession(q.getSession.get(sessionId) as SessionRow);
        return { ok: true, data: updated };
      } catch (e) {
        return errResult(`SESSION_UPDATE_FAILED: ${(e as Error).message}`);
      }
    },

    getSession(sessionId: string): Result<Session> {
      try {
        const row = q.getSession.get(sessionId) as SessionRow | null;
        if (!row) return errResult("SESSION_NOT_FOUND");
        return { ok: true, data: mapSession(row) };
      } catch (e) {
        return errResult(`SESSION_READ_FAILED: ${(e as Error).message}`);
      }
    },

    getSessionByOcId(ocSessionId: string): Result<Session> {
      try {
        const row = q.getSessionByOcId.get(ocSessionId) as SessionRow | null;
        if (!row) return errResult("SESSION_NOT_FOUND");
        return { ok: true, data: mapSession(row) };
      } catch (e) {
        return errResult(`SESSION_READ_FAILED: ${(e as Error).message}`);
      }
    },

    listSessions(): Session[] {
      return (q.listSessions.all() as SessionRow[]).map(mapSession);
    },

    /**
     * Hapus Session beserta seluruh baris anaknya (messages, prompts,
     * riwayat status) dalam satu transaksi. Gagal di tengah jalan di-rollback
     * agar data tidak setengah terhapus.
     */
    deleteSession(sessionId: string): SimpleResult {
      try {
        const existing = q.getSession.get(sessionId) as SessionRow | null;
        if (!existing) return errResult("SESSION_NOT_FOUND");
        const tx = db.transaction(() => {
          q.deleteSessionMessages.run(sessionId);
          q.deleteSessionPrompts.run(sessionId);
          q.deleteSessionHistory.run(sessionId);
          q.deleteSessionRow.run(sessionId);
        });
        tx();
        return { ok: true };
      } catch (e) {
        return errResult(`SESSION_DELETE_FAILED: ${(e as Error).message}`);
      }
    },

    // ---------------- Projects (CRUD) ----------------
    insertProject(project: Project): Result<Project> {
      try {
        q.insertProject.run(project.id, project.name, project.path, project.createdAt);
        return { ok: true, data: project };
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes("projects.name")) return errResult("NAME_TAKEN");
        if (msg.includes("projects.path")) return errResult("PATH_TAKEN");
        return errResult(`PROJECT_WRITE_FAILED: ${msg}`);
      }
    },

    getProjectById(id: string): Result<Project> {
      const row = q.getProjectById.get(id) as ProjectRow | null;
      if (!row) return errResult("PROJECT_NOT_FOUND");
      return { ok: true, data: mapProject(row) };
    },

    getProjectByName(name: string): Result<Project> {
      const row = q.getProjectByName.get(name) as ProjectRow | null;
      if (!row) return errResult("PROJECT_NOT_FOUND");
      return { ok: true, data: mapProject(row) };
    },

    getProjectByPath(filePath: string): Result<Project> {
      const row = q.getProjectByPath.get(filePath) as ProjectRow | null;
      if (!row) return errResult("PROJECT_NOT_FOUND");
      return { ok: true, data: mapProject(row) };
    },

    listProjects(): Project[] {
      return (q.listProjects.all() as ProjectRow[]).map(mapProject);
    },

    listProjectSessions(projectId: string): Session[] {
      return (q.listProjectSessions.all(projectId) as SessionRow[]).map(mapSession);
    },

    /**
     * Hapus baris Project. Session milik Project harus sudah dihapus lebih
     * dulu: `sessions.project_id` punya foreign key ke `projects(id)`, dan
     * menghapus Session lewat jalur ini akan melewatkan pembersihan sesi
     * remote opencode + lampiran gambarnya.
     */
    deleteProject(projectId: string): SimpleResult {
      try {
        const existing = q.getProjectById.get(projectId) as ProjectRow | null;
        if (!existing) return errResult("PROJECT_NOT_FOUND");
        const sessions = q.listProjectSessions.all(projectId) as SessionRow[];
        if (sessions.length > 0) return errResult("PROJECT_HAS_SESSIONS");
        q.deleteProjectRow.run(projectId);
        return { ok: true };
      } catch (e) {
        return errResult(`PROJECT_DELETE_FAILED: ${(e as Error).message}`);
      }
    },

    // ---------------- Prompts (CRUD) ----------------
    insertPrompt(prompt: InteractivePrompt): Result<InteractivePrompt> {
      try {
        if (!q.sessionExists.get(prompt.sessionId)) return errResult("SESSION_NOT_FOUND");
        q.insertPrompt.run(
          prompt.id,
          prompt.sessionId,
          prompt.kind,
          prompt.type,
          prompt.custom === true ? 1 : 0,
          prompt.title,
          prompt.options ? JSON.stringify(prompt.options) : null,
          prompt.status,
          prompt.createdAt,
          prompt.resolvedAt,
        );
        return { ok: true, data: prompt };
      } catch (e) {
        return errResult(`PROMPT_WRITE_FAILED: ${(e as Error).message}`);
      }
    },

    getPrompt(promptId: string): Result<InteractivePrompt> {
      const row = q.getPrompt.get(promptId) as PromptRow | null;
      if (!row) return errResult("PROMPT_NOT_FOUND");
      return { ok: true, data: mapPrompt(row) };
    },

    listPendingPrompts(sessionId: string): InteractivePrompt[] {
      return (q.pendingPrompts.all(sessionId) as PromptRow[]).map(mapPrompt);
    },

    updatePromptStatus(promptId, status, resolvedAt = Date.now()): Result<InteractivePrompt> {
      try {
        const existing = q.getPrompt.get(promptId) as PromptRow | null;
        if (!existing) return errResult("PROMPT_NOT_FOUND");
        q.updatePrompt.run(status, resolvedAt, promptId);
        const updated = mapPrompt(q.getPrompt.get(promptId) as PromptRow);
        return { ok: true, data: updated };
      } catch (e) {
        return errResult(`PROMPT_UPDATE_FAILED: ${(e as Error).message}`);
      }
    },

    close() {
      db.close();
    },
  };

  return store;
}
