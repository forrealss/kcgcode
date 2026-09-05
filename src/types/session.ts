/**
 * Tipe domain Session (headless mode).
 *
 * `Session.ocSessionId` menyimpan id Session di server headless opencode
 * (`ses_...`) sebagai pemetaan ke id Session lokal — perubahan dari versi
 * PTY/TUI.
 */
export type AgentType = "opencode" | "claude-code";

export type SessionStatus = "running" | "stopped" | "crashed";

/**
 * Model LLM pilihan untuk Session (dipakai saat mengirim prompt).
 * `null` = biarkan opencode memakai model default-nya.
 */
export interface SessionModel {
  providerID: string;
  modelID: string;
}

/**
 * Agent (mode) opencode pilihan untuk Session — dibaca dari `GET /agent`
 * server headless, dipakai saat mengirim prompt (body `agent`).
 * `null` = biarkan opencode memakai agent default-nya (biasanya `build`).
 */
export interface SessionAgent {
  name: string;
  mode: "primary" | "subagent" | "all";
  description: string | null;
}

export interface Session {
  id: string;
  projectId: string;
  agentType: AgentType;
  cwd: string;
  status: SessionStatus;
  /** Id Session di server headless opencode (`ses_...`); null sebelum dibuat. */
  ocSessionId: string | null;
  /** Model LLM pilihan; null = model default opencode. */
  model: SessionModel | null;
  /** Agent (mode) pilihan; null = agent default opencode (build). */
  agent: string | null;
  createdAt: number;
  updatedAt: number;
}
