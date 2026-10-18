/** Bentuk data yang dikirim API overlay (`overlay-api.ts`). */

export type SessionStatus = "running" | "stopped" | "crashed";

export interface SessionInfo {
  id: string;
  title: string | null;
  status: SessionStatus;
  turnActive: boolean;
}

export interface ServerInfo {
  phase: "stopped" | "starting" | "running" | "exited" | "crashed";
  port: number | null;
}

export type OverlayEvent =
  | { type: "turn"; active: boolean }
  | { type: "status"; status: SessionStatus }
  | { type: "reply"; text: string }
  | { type: "attention"; pending: boolean }
  | { type: "agent_error"; message: string }
  | { type: "server"; server: ServerInfo | null }
  | { type: "draft"; draft: ComposerDraft; origin: string };

export interface CapturedError {
  message: string;
  detail: string;
  count: number;
}

/** Draf composer bersama Session (cermin `src/types/draft.ts`). */
export interface DraftAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
}

export interface ComposerDraft {
  text: string;
  attachments: DraftAttachment[];
  elements: Array<{ label: string; context: string; key: string; pages: string[] }>;
}

/** Lampiran draf di overlay: `url` = pratinjau (blob) gambar, null = belum/tidak ada. */
export interface OverlayAttachment extends DraftAttachment {
  url: string | null;
}
