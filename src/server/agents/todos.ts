import type { TodoItem } from "../../types";

/**
 * Task list dari input tool todo agent (`{ todos: [{ content, status, priority? }] }`)
 * — `TodoWrite` Claude Code maupun `todowrite` opencode.
 */
export function todosFromInput(input: unknown): TodoItem[] | null {
  if (typeof input !== "object" || input === null) return null;
  const raw = (input as { todos?: unknown }).todos;
  if (!Array.isArray(raw)) return null;
  const out: TodoItem[] = [];
  for (const t of raw) {
    if (typeof t !== "object" || t === null) continue;
    const { content, status, priority } = t as Record<string, unknown>;
    if (typeof content !== "string") continue;
    out.push({
      content,
      status: typeof status === "string" ? status : "pending",
      // TodoWrite Claude Code tidak punya prioritas — UI tetap butuh nilai.
      priority: typeof priority === "string" ? priority : "medium",
    });
  }
  return out;
}
