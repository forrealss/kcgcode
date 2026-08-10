/**
 * Session_Store — persistensi `bun:sqlite`.
 * Sesuai `design.md` — skema SQLite & `db.ts`.
 *
 * Konvensi:
 * - `output_stream` dan `session_status_history` bersifat **append-only**
 *   (insert-only, tidak pernah UPDATE/DELETE) sehingga Requirement 3.1/3.3
 *   terpenuhi secara struktural.
 * - Seluruh operasi tulis dibungkus try/catch; kegagalan mengembalikan
 *   `{ ok: false, error }` tanpa menghapus data lama (Requirement 3.2).
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type {
  InteractivePrompt,
  OutputChunk,
  Project,
  PromptStatus,
  Result,
  Session,
  SessionStatus,
  StatusHistoryEntry,
} from "./types";

export const DEFAULT_DB_PATH = "data/kcg-bridge.sqlite";

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

-- Append-only: tidak pernah UPDATE/DELETE (Requirement 3.1, 3.2)
CREATE TABLE IF NOT EXISTS output_stream (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  seq INTEGER NOT NULL,
  chunk TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(session_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_output_stream_session_seq ON output_stream(session_id, seq);

CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  type TEXT NOT NULL CHECK (type IN ('confirmation','menu')),
  options_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','resolved')),
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_prompts_session_status ON prompts(session_id, status);
`;

export interface SessionStore {
  // ---- Output_Stream (append-only) ----
  insertOutputChunk(chunk: OutputChunk): Result<OutputChunk>;
  getOutputChunks(sessionId: string): Result<OutputChunk[]>;
  getLastSeq(sessionId: string): number;

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
  getSession(sessionId: string): Result<Session>;
  listSessions(): Session[];

  // ---- Projects (CRUD) ----
  insertProject(project: Project): Result<Project>;
  getProjectById(id: string): Result<Project>;
  getProjectByName(name: string): Result<Project>;
  getProjectByPath(filePath: string): Result<Project>;
  listProjects(): Project[];

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
  created_at: number;
  updated_at: number;
}

interface PromptRow {
  id: string;
  session_id: string;
  type: string;
  options_json: string | null;
  status: string;
  created_at: number;
  resolved_at: number | null;
}

function mapProject(r: ProjectRow): Project {
  return { id: r.id, name: r.name, path: r.path, createdAt: r.created_at };
}

function mapSession(r: SessionRow): Session {
  return {
    id: r.id,
    projectId: r.project_id,
    agentType: r.agent_type as Session["agentType"],
    cwd: r.cwd,
    status: r.status as SessionStatus,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapPrompt(r: PromptRow): InteractivePrompt {
  return {
    id: r.id,
    sessionId: r.session_id,
    type: r.type as InteractivePrompt["type"],
    options: r.options_json ? (JSON.parse(r.options_json) as string[]) : null,
    status: r.status as PromptStatus,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
  };
}

function errResult(msg: string): { ok: false; error: string } {
  return { ok: false, error: msg };
}

/**
 * Membuka koneksi ke database, menyalakan WAL, dan menjalankan migrasi
 * idempoten. Default `data/kcg-bridge.sqlite`.
 */
export function openSessionStore(dbPath: string = DEFAULT_DB_PATH): SessionStore {
  if (dbPath !== ":memory:") {
    mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);

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

    insertSession: db.query(
      "INSERT INTO sessions (id, project_id, agent_type, cwd, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ),
    getSession: db.query("SELECT * FROM sessions WHERE id = ?"),
    listSessions: db.query("SELECT * FROM sessions ORDER BY created_at ASC, id ASC"),
    updateSession: db.query("UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?"),

    insertOutput: db.query(
      "INSERT INTO output_stream (session_id, seq, chunk, created_at) VALUES (?, ?, ?, ?)",
    ),
    getOutputs: db.query(
      "SELECT session_id, seq, chunk, created_at FROM output_stream WHERE session_id = ? ORDER BY seq ASC",
    ),
    maxSeq: db.query("SELECT COALESCE(MAX(seq), 0) AS m FROM output_stream WHERE session_id = ?"),

    insertHistory: db.query(
      "INSERT INTO session_status_history (session_id, status, changed_at) VALUES (?, ?, ?)",
    ),
    getHistory: db.query(
      "SELECT session_id, status, changed_at FROM session_status_history WHERE session_id = ? ORDER BY id ASC",
    ),

    insertPrompt: db.query(
      "INSERT INTO prompts (id, session_id, type, options_json, status, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ),
    getPrompt: db.query("SELECT * FROM prompts WHERE id = ?"),
    pendingPrompts: db.query(
      "SELECT * FROM prompts WHERE session_id = ? AND status = 'pending' ORDER BY created_at ASC, id ASC",
    ),
    updatePrompt: db.query("UPDATE prompts SET status = ?, resolved_at = ? WHERE id = ?"),
  };

  const store: SessionStore = {
    // ---------------- Output_Stream (append-only) ----------------
    insertOutputChunk(chunk: OutputChunk): Result<OutputChunk> {
      try {
        if (!q.sessionExists.get(chunk.sessionId)) return errResult("SESSION_NOT_FOUND");
        q.insertOutput.run(chunk.sessionId, chunk.seq, chunk.data, chunk.ts);
        return { ok: true, data: chunk };
      } catch (e) {
        return errResult(`OUTPUT_WRITE_FAILED: ${(e as Error).message}`);
      }
    },

    getOutputChunks(sessionId: string): Result<OutputChunk[]> {
      try {
        if (!q.sessionExists.get(sessionId)) return errResult("SESSION_NOT_FOUND");
        const rows = q.getOutputs.all(sessionId) as {
          session_id: string;
          seq: number;
          chunk: string;
          created_at: number;
        }[];
        return {
          ok: true,
          data: rows.map((r) => ({
            sessionId: r.session_id,
            seq: r.seq,
            data: r.chunk,
            ts: r.created_at,
          })),
        };
      } catch (e) {
        return errResult(`OUTPUT_READ_FAILED: ${(e as Error).message}`);
      }
    },

    getLastSeq(sessionId: string): number {
      const row = q.maxSeq.get(sessionId) as { m: number };
      return row?.m ?? 0;
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

    getSession(sessionId: string): Result<Session> {
      try {
        const row = q.getSession.get(sessionId) as SessionRow | null;
        if (!row) return errResult("SESSION_NOT_FOUND");
        return { ok: true, data: mapSession(row) };
      } catch (e) {
        return errResult(`SESSION_READ_FAILED: ${(e as Error).message}`);
      }
    },

    listSessions(): Session[] {
      return (q.listSessions.all() as SessionRow[]).map(mapSession);
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

    // ---------------- Prompts (CRUD) ----------------
    insertPrompt(prompt: InteractivePrompt): Result<InteractivePrompt> {
      try {
        if (!q.sessionExists.get(prompt.sessionId)) return errResult("SESSION_NOT_FOUND");
        q.insertPrompt.run(
          prompt.id,
          prompt.sessionId,
          prompt.type,
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
