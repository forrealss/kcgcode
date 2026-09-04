/**
 * Tipe Interactive_Prompt (permission/question).
 *
 * `InteractivePrompt` bersumber dari event terstruktur opencode
 * (`permission.asked` / `question.asked`) lewat field `kind` — bukan hasil
 * regex atas teks TUI (`prompt-detector.ts` dihapus).
 */
export type PromptType = "confirmation" | "menu";

export type PromptStatus = "pending" | "resolved";

/** Sumber Interactive_Prompt: izin tool (permission) atau pertanyaan (question). */
export type PromptKind = "permission" | "question";

export interface InteractivePrompt {
  /** Id request opencode (`per_...` / `que_...`) — dipakai untuk reply. */
  id: string;
  sessionId: string;
  kind: PromptKind;
  type: PromptType;
  /** Teks pertanyaan (question) atau deskripsi izin (permission). */
  title: string | null;
  options: string[] | null;
  status: PromptStatus;
  createdAt: number;
  resolvedAt: number | null;
}

export type PromptResponse = "approve" | "deny" | "cancel" | { option: string };
