/**
 * Protokol pesan WebSocket bersama Client <-> Server (versi headless).
 *
 * Perubahan dari versi PTY/TUI:
 * - `history` kini membawa `messages` (SessionMessage terstruktur) dan
 *   `prompts` (pending) — bukan chunk Output_Stream.
 * - `output`/`resize` dihapus; digantikan `message` dan `stop`.
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
  | { type: "input"; sessionId: string; text: string }
  | { type: "prompt_response"; sessionId: string; promptId: string; response: PromptResponse }
  | { type: "stop"; sessionId: string };

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
  | { type: "error"; code: string; message: string };

/** Kode error umum pada pesan `error`. */
export const ErrorCodes = {
  SESSION_NOT_FOUND: "SESSION_NOT_FOUND",
  PROMPT_NOT_FOUND: "PROMPT_NOT_FOUND",
  PROMPT_ALREADY_RESOLVED: "PROMPT_ALREADY_RESOLVED",
  INVALID_RESPONSE: "INVALID_RESPONSE",
  SESSION_NOT_RUNNING: "SESSION_NOT_RUNNING",
  INVALID_TEXT: "INVALID_TEXT",
  AUTH_FAILED: "AUTH_FAILED",
} as const;
