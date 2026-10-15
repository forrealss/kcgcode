/**
 * Helper murni (tanpa React) untuk engine percakapan Session
 * (`hooks/useSessionChat.ts`): pesan optimistis prompt pertama, klasifikasi
 * error WS, dan turunan state (streaming, question pending, key blok
 * "Thought process"). Dipisah agar bisa diuji langsung dengan `bun test`.
 */
import { groupTurns, turnBlocks, turnSegments } from "@/lib/turns";
import type { InteractivePrompt, SessionMessage } from "@/types";

/** Id pesan user optimistis (prompt pertama dari homepage). */
export const OPTIMISTIC_ID = "optimistic:first-prompt";

/** Pesan user optimistis untuk prompt pertama dari homepage. */
export function createOptimisticMessage(sessionId: string, text: string): SessionMessage {
  return {
    id: OPTIMISTIC_ID,
    sessionId,
    role: "user",
    parts: [{ type: "text", text }],
    createdAt: Date.now(),
  };
}

/** Tambahkan prompt baru; prompt dengan id yang sama diabaikan (array lama dikembalikan). */
export function appendPrompt(
  prev: InteractivePrompt[],
  prompt: InteractivePrompt,
): InteractivePrompt[] {
  return prev.some((p) => p.id === prompt.id) ? prev : [...prev, prompt];
}

/**
 * Error terkait prompt ditampilkan di kartunya masing-masing —
 * banner global di atas chat tidak terlihat oleh user yang sedang
 * fokus ke kartu (tombol terasa "mati" tanpa feedback).
 */
export function isPromptCardErrorCode(code: string): boolean {
  return (
    code === "PROMPT_NOT_FOUND" || code === "PROMPT_ALREADY_RESOLVED" || code === "PROMPT_FAILED"
  );
}

/** Pesan assistant yang masih di-stream (belum digantikan versi final). */
export function isStreamingAssistant(m: SessionMessage): boolean {
  return m.role === "assistant" && m.streaming === true;
}

/**
 * Key blok collapsible "Thought process": satu blok per turn (id pesan
 * pertama grup) yang punya langkah reasoning/tool.
 */
export function thoughtBlockKeys(messages: readonly SessionMessage[]): string[] {
  const keys: string[] = [];
  for (const g of groupTurns(messages)) {
    if (g.kind !== "assistant") continue;
    if (!g.messages.some((m) => m.parts.some((p) => p.type === "reasoning" || p.type === "tool")))
      continue;
    const segs = turnSegments(g.messages);
    for (const block of turnBlocks(segs)) {
      if (block.steps.length > 0) keys.push(`${g.id}:${block.key}`);
    }
  }
  return keys;
}

/**
 * Ada question pending? Composer disembunyikan dan panel question docked
 * menggantikannya — jawaban pertanyaan adalah input saat ini (ala TUI
 * opencode yang menutup input teks selama question aktif). Permission
 * kartu tidak menggantikan composer (tetap floating).
 */
export function hasPendingQuestionPrompt(prompts: readonly InteractivePrompt[]): boolean {
  return prompts.some((p) => p.kind === "question" || p.kind === "plan");
}
