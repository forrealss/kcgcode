/**
 * `Session_Store` — komposisi root persistensi `bun:sqlite` (headless).
 * Sesuai `design.md`: koneksi DB + migrasi + penyatuan repository per-domain.
 *
 * Lapisan repository hidup di `src/server/db/`:
 * - `schema.ts`        — skema SQLite & migrasi idempoten
 * - `rows.ts`          — pemetaan baris SQLite -> tipe domain
 * - `projects.ts`      — repository Projects
 * - `sessions.ts`      — repository Sessions + riwayat status (append-only)
 * - `messages.ts`      — repository pesan terstruktur (append-only)
 * - `prompts.ts`       — repository prompt interaktif
 *
 * Konvensi: `session_status_history` dan `messages` bersifat **append-only**
 * (insert-only) sehingga Requirement 3.1/3.3 terpenuhi secara struktural.
 * Seluruh operasi tulis dibungkus try/catch; kegagalan mengembalikan
 * `{ ok: false, error }` tanpa menghapus data lama (Requirement 3.2).
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createMessageRepo, type MessageRepo } from "./server/db/messages";
import { createProjectRepo, type ProjectRepo } from "./server/db/projects";
import { createPromptRepo, type PromptRepo } from "./server/db/prompts";
import { runMigrations } from "./server/db/schema";
import { createSessionRepo, type SessionRepo, type StatusHistoryEntry } from "./server/db/sessions";
import type { Result, SimpleResult } from "./server/result";
import type {
  InteractivePrompt,
  Project,
  PromptStatus,
  Session,
  SessionMessage,
  SessionModel,
  SessionStatus,
} from "./types";

export const DEFAULT_DB_PATH = "data/kcg-code.sqlite";

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

/**
 * Membuka koneksi ke database, menyalakan WAL, menjalankan migrasi
 * idempoten, lalu menyatukan repository per-domain menjadi satu `SessionStore`.
 * Default `data/kcg-code.sqlite`.
 */
export function openSessionStore(dbPath: string = DEFAULT_DB_PATH): SessionStore {
  if (dbPath !== ":memory:") {
    mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  runMigrations(db);

  const projects: ProjectRepo = createProjectRepo(db);
  const sessions: SessionRepo = createSessionRepo(db);
  const messages: MessageRepo = createMessageRepo(db);
  const prompts: PromptRepo = createPromptRepo(db);

  const store: SessionStore = {
    ...projects,
    ...sessions,
    ...messages,
    ...prompts,
    close() {
      db.close();
    },
  };

  return store;
}
