/**
 * Protokol pesan WebSocket bersama Client <-> Server.
 * Sesuai `design.md` — Protokol Pesan WebSocket.
 */
import type { InteractivePrompt, PromptResponse, SessionStatus } from "./types";

/** Payload chunk riwayat Output_Stream pada pesan `history`. */
export interface HistoryChunk {
  seq: number;
  data: string;
  ts: number;
}

/** Pesan Client -> Server. */
export type ClientMessage =
  | { type: "attach"; sessionId: string }
  | { type: "input"; sessionId: string; text: string }
  | { type: "prompt_response"; sessionId: string; promptId: string; response: PromptResponse }
  | { type: "resize"; sessionId: string; cols: number; rows: number };

/** Pesan Server -> Client. */
export type ServerMessage =
  | { type: "history"; sessionId: string; chunks: HistoryChunk[] }
  | { type: "output"; sessionId: string; seq: number; data: string; ts: number }
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
  INVALID_SIZE: "INVALID_SIZE",
  AUTH_FAILED: "AUTH_FAILED",
} as const;
