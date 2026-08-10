/**
 * Tipe domain bersama untuk KCG Bridge.
 * Sesuai `design.md` — Data Models.
 */

export type AgentType = "opencode" | "claude-code";

export type SessionStatus = "running" | "stopped" | "crashed";

export type PromptType = "confirmation" | "menu";

export type PromptStatus = "pending" | "resolved";

export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: number;
}

export interface Session {
  id: string;
  projectId: string;
  agentType: AgentType;
  cwd: string;
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
}

export interface OutputChunk {
  sessionId: string;
  seq: number;
  data: string;
  ts: number;
}

export interface InteractivePrompt {
  id: string;
  sessionId: string;
  type: PromptType;
  options: string[] | null;
  status: PromptStatus;
  createdAt: number;
  resolvedAt: number | null;
}

export type PromptResponse = "approve" | "deny" | "cancel" | { option: string };

/** Satu entri riwayat status (append-only). */
export interface StatusHistoryEntry {
  sessionId: string;
  status: SessionStatus;
  changedAt: number;
}

/**
 * Tipe hasil diskriminasi yang dipakai seluruh layer domain:
 * `{ ok: true; data } | { ok: false; error }` — bukan `throw`,
 * sesuai `design.md` — Error Handling.
 */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };
