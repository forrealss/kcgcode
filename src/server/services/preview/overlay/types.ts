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
  | { type: "server"; server: ServerInfo | null };

export interface CapturedError {
  message: string;
  detail: string;
  count: number;
}
