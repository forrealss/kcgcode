/**
 * Protokol pesan WebSocket bersama Client <-> Server (versi headless).
 *
 * Perubahan dari versi PTY/TUI:
 * - `history` kini membawa `messages` (SessionMessage terstruktur) dan
 *   `prompts` (pending) — bukan chunk Output_Stream.
 * - `output`/`resize` dihapus; digantikan `message`, `stop` (hentikan Session)
 *   dan `interrupt` (hentikan balasan model saja — Session tetap berjalan).
 * - `turn_active` memberi tahu Client kapan model sedang merespon (turn
 *   streaming aktif) sehingga tombol stop/interrupt bisa ditampilkan.
 */
import type {
  InteractivePrompt,
  MessagePart,
  PromptResponse,
  SessionMessage,
  SessionStatus,
} from "./types";

/** Pesan Client -> Server. */
export type ClientMessage =
  | { type: "attach"; sessionId: string }
  | {
      type: "input";
      sessionId: string;
      text: string;
      /** Path relatif project untuk referensi `@file` (dibaca sebagai teks). */
      files?: string[];
      /** Id lampiran gambar di Attachment_Store KCG (upload dari perangkat). */
      images?: string[];
    }
  | { type: "prompt_response"; sessionId: string; promptId: string; response: PromptResponse }
  | { type: "stop"; sessionId: string }
  /**
   * Hentikan balasan model yang sedang berlangsung (interrupt ala opencode):
   * turn di-abort tapi Session tetap `running` sehingga bisa langsung kirim
   * pesan baru. Beda dari `stop` yang menonaktifkan Session.
   */
  | { type: "interrupt"; sessionId: string };

/** Pesan Server -> Client. */
export type ServerMessage =
  | {
      type: "history";
      sessionId: string;
      messages: SessionMessage[];
      prompts: InteractivePrompt[];
    }
  | { type: "message"; sessionId: string; message: SessionMessage }
  /** Part pesan yang sedang di-stream (SSE `message.part.updated`). */
  | { type: "message_part"; sessionId: string; messageId: string; part: MessagePart }
  | { type: "prompt"; sessionId: string; prompt: InteractivePrompt }
  | { type: "prompt_resolved"; sessionId: string; promptId: string }
  | { type: "session_status"; sessionId: string; status: SessionStatus }
  /** Status turn: `active: true` = model sedang merespon; `false` = berhenti. */
  | { type: "turn_active"; sessionId: string; active: boolean }
  /** Session dihapus permanen — subscriber harus meninggalkan halamannya. */
  | { type: "session_deleted"; sessionId: string }
  | { type: "error"; code: string; message: string };

/** Kode error umum pada pesan `error`. */
export const ErrorCodes = {
  SESSION_NOT_FOUND: "SESSION_NOT_FOUND",
  PROMPT_NOT_FOUND: "PROMPT_NOT_FOUND",
  PROMPT_ALREADY_RESOLVED: "PROMPT_ALREADY_RESOLVED",
  /** Reply prompt gagal diproses server opencode (mis. reply 404/400). */
  PROMPT_FAILED: "PROMPT_FAILED",
  INVALID_RESPONSE: "INVALID_RESPONSE",
  SESSION_NOT_RUNNING: "SESSION_NOT_RUNNING",
  INVALID_TEXT: "INVALID_TEXT",
  ATTACHMENT_NOT_FOUND: "ATTACHMENT_NOT_FOUND",
  AUTH_FAILED: "AUTH_FAILED",
} as const;
