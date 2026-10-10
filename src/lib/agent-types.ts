/**
 * Tipe CLI_Agent yang bisa dipilih di UI (backend Session).
 *
 * - `opencode`    : server headless `opencode serve`.
 * - `claude-code` : Claude Code lewat Claude Agent SDK (ikut settings user).
 */
import type { AgentType } from "@/types";

export const AGENT_TYPES: readonly AgentType[] = ["opencode", "claude-code"];

export const AGENT_TYPE_LABELS: Record<AgentType, string> = {
  opencode: "OpenCode",
  "claude-code": "Claude Code",
};

/**
 * Query string `?agent=` untuk daftar model/agent Project. opencode tanpa
 * query (default server) agar URL lama tidak berubah.
 */
export function agentQuery(agentType: AgentType): string {
  return agentType === "claude-code" ? "?agent=claude-code" : "";
}
