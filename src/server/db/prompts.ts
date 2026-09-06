/**
 * Repository prompt interaktif (permission/question opencode) per Session.
 */
import type { Database } from "bun:sqlite";
import type { InteractivePrompt, PromptStatus } from "../../types";
import type { Result } from "../result";
import { errResult, mapPrompt, type PromptRow } from "./rows";
import { sessionExists } from "./sessions";

export function createPromptRepo(db: Database) {
  const q = {
    insertPrompt: db.query(
      "INSERT INTO prompts (id, session_id, kind, type, custom, title, options_json, status, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ),
    getPrompt: db.query("SELECT * FROM prompts WHERE id = ?"),
    pendingPrompts: db.query(
      "SELECT * FROM prompts WHERE session_id = ? AND status = 'pending' ORDER BY created_at ASC, id ASC",
    ),
    updatePrompt: db.query("UPDATE prompts SET status = ?, resolved_at = ? WHERE id = ?"),
  };

  return {
    insertPrompt(prompt: InteractivePrompt): Result<InteractivePrompt> {
      try {
        if (!sessionExists(db, prompt.sessionId)) return errResult("SESSION_NOT_FOUND");
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

    updatePromptStatus(
      promptId: string,
      status: PromptStatus,
      resolvedAt = Date.now(),
    ): Result<InteractivePrompt> {
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
  };
}

export type PromptRepo = ReturnType<typeof createPromptRepo>;
