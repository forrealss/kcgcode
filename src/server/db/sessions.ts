/**
 * Repository Sessions + riwayat statusnya. Status history bukan domain
 * terpisah melainkan sub-entitas agregat Session (tabel-nya pun
 * `session_status_history`), sehingga transaksi yang menyentuh keduanya
 * (`updateSessionStatus`) dan cascade delete tinggal di sini.
 */
import type { Database } from "bun:sqlite";
import type { Session, SessionModel, SessionStatus } from "../../types";
import type { Result, SimpleResult } from "../result";
import { errResult, mapSession, type SessionRow } from "./rows";

/** Satu entri riwayat status (append-only). */
export interface StatusHistoryEntry {
  sessionId: string;
  status: SessionStatus;
  changedAt: number;
}

export function sessionExists(db: Database, sessionId: string): unknown {
  return db.query("SELECT id FROM sessions WHERE id = ?").get(sessionId);
}

export function createSessionRepo(db: Database) {
  const q = {
    projectById: db.query("SELECT id FROM projects WHERE id = ?"),
    insertSession: db.query(
      "INSERT INTO sessions (id, project_id, agent_type, cwd, status, oc_session_id, model, agent, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ),
    getSession: db.query("SELECT * FROM sessions WHERE id = ?"),
    getSessionByOcId: db.query("SELECT * FROM sessions WHERE oc_session_id = ?"),
    listSessions: db.query("SELECT * FROM sessions ORDER BY created_at ASC, id ASC"),
    updateSessionStatus: db.query("UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?"),
    updateSessionOcId: db.query(
      "UPDATE sessions SET oc_session_id = ?, updated_at = ? WHERE id = ?",
    ),
    updateSessionModel: db.query("UPDATE sessions SET model = ?, updated_at = ? WHERE id = ?"),
    updateSessionAgent: db.query("UPDATE sessions SET agent = ?, updated_at = ? WHERE id = ?"),
    updateSessionTitle: db.query("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?"),
    deleteSessionMessages: db.query("DELETE FROM messages WHERE session_id = ?"),
    deleteSessionPrompts: db.query("DELETE FROM prompts WHERE session_id = ?"),
    deleteSessionHistory: db.query("DELETE FROM session_status_history WHERE session_id = ?"),
    deleteSessionRow: db.query("DELETE FROM sessions WHERE id = ?"),
    insertHistory: db.query(
      "INSERT INTO session_status_history (session_id, status, changed_at) VALUES (?, ?, ?)",
    ),
    getHistory: db.query(
      "SELECT session_id, status, changed_at FROM session_status_history WHERE session_id = ? ORDER BY id ASC",
    ),
  };

  function findRow(sessionId: string): SessionRow | null {
    return q.getSession.get(sessionId) as SessionRow | null;
  }

  return {
    insertSession(session: Session): Result<Session> {
      try {
        if (!q.projectById.get(session.projectId)) return errResult("PROJECT_NOT_FOUND");
        q.insertSession.run(
          session.id,
          session.projectId,
          session.agentType,
          session.cwd,
          session.status,
          session.ocSessionId,
          session.model ? JSON.stringify(session.model) : null,
          session.agent ?? null,
          session.title ?? null,
          session.createdAt,
          session.updatedAt,
        );
        return { ok: true, data: session };
      } catch (e) {
        return errResult(`SESSION_WRITE_FAILED: ${(e as Error).message}`);
      }
    },

    updateSessionStatus(
      sessionId: string,
      status: SessionStatus,
      changedAt = Date.now(),
    ): Result<Session> {
      try {
        if (!findRow(sessionId)) return errResult("SESSION_NOT_FOUND");
        const tx = db.transaction(() => {
          q.updateSessionStatus.run(status, changedAt, sessionId);
          q.insertHistory.run(sessionId, status, changedAt);
        });
        tx();
        const updated = mapSession(findRow(sessionId) as SessionRow);
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
        if (!findRow(sessionId)) return errResult("SESSION_NOT_FOUND");
        q.updateSessionOcId.run(ocSessionId, Date.now(), sessionId);
        return { ok: true, data: mapSession(findRow(sessionId) as SessionRow) };
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
        if (!findRow(sessionId)) return errResult("SESSION_NOT_FOUND");
        q.updateSessionModel.run(model ? JSON.stringify(model) : null, Date.now(), sessionId);
        return { ok: true, data: mapSession(findRow(sessionId) as SessionRow) };
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
        if (!findRow(sessionId)) return errResult("SESSION_NOT_FOUND");
        q.updateSessionAgent.run(agent ?? null, Date.now(), sessionId);
        return { ok: true, data: mapSession(findRow(sessionId) as SessionRow) };
      } catch (e) {
        return errResult(`SESSION_UPDATE_FAILED: ${(e as Error).message}`);
      }
    },

    /**
     * Simpan judul Session hasil generate opencode (SSE `session.updated`).
     * Tanpa mengubah status; dipanggil berulang aman (judul sama dioverwrite).
     */
    updateSessionTitle(sessionId: string, title: string): Result<Session> {
      try {
        if (!findRow(sessionId)) return errResult("SESSION_NOT_FOUND");
        q.updateSessionTitle.run(title, Date.now(), sessionId);
        return { ok: true, data: mapSession(findRow(sessionId) as SessionRow) };
      } catch (e) {
        return errResult(`SESSION_UPDATE_FAILED: ${(e as Error).message}`);
      }
    },

    getSession(sessionId: string): Result<Session> {
      try {
        const row = findRow(sessionId);
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
        if (!findRow(sessionId)) return errResult("SESSION_NOT_FOUND");
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

    // ---------------- Riwayat status (append-only) ----------------

    insertStatusHistory(
      sessionId: string,
      status: SessionStatus,
      changedAt = Date.now(),
    ): Result<StatusHistoryEntry> {
      try {
        if (!sessionExists(db, sessionId)) return errResult("SESSION_NOT_FOUND");
        q.insertHistory.run(sessionId, status, changedAt);
        return { ok: true, data: { sessionId, status, changedAt } };
      } catch (e) {
        return errResult(`HISTORY_WRITE_FAILED: ${(e as Error).message}`);
      }
    },

    getStatusHistory(sessionId: string): Result<StatusHistoryEntry[]> {
      try {
        if (!sessionExists(db, sessionId)) return errResult("SESSION_NOT_FOUND");
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
  };
}

export type SessionRepo = ReturnType<typeof createSessionRepo>;
