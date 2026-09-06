/**
 * Repository pesan percakapan terstruktur (append-only). Seluruh tulis baca
 * pesan milik satu Session, jadi penjagaan `SESSION_NOT_FOUND` ada di sini.
 */
import type { Database } from "bun:sqlite";
import type { SessionMessage } from "../../types";
import type { Result } from "../result";
import { errResult, type MessageRow, mapMessage } from "./rows";
import { sessionExists } from "./sessions";

export function createMessageRepo(db: Database) {
  const q = {
    insertMessage: db.query(
      "INSERT INTO messages (session_id, message_id, role, parts_json, created_at) VALUES (?, ?, ?, ?, ?)",
    ),
    getMessages: db.query(
      "SELECT session_id, message_id, role, parts_json, created_at FROM messages WHERE session_id = ? ORDER BY created_at ASC, id ASC",
    ),
  };

  return {
    insertMessage(message: SessionMessage): Result<SessionMessage> {
      try {
        if (!sessionExists(db, message.sessionId)) return errResult("SESSION_NOT_FOUND");
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
        if (!sessionExists(db, sessionId)) return errResult("SESSION_NOT_FOUND");
        const rows = q.getMessages.all(sessionId) as MessageRow[];
        return { ok: true, data: rows.map(mapMessage) };
      } catch (e) {
        return errResult(`MESSAGE_READ_FAILED: ${(e as Error).message}`);
      }
    },
  };
}

export type MessageRepo = ReturnType<typeof createMessageRepo>;
