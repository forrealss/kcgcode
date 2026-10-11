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
 * Agent terakhir yang dipakai untuk membuat Session (composer homepage &
 * dialog New Session), diingat per perangkat. Kunci lama dipertahankan agar
 * pilihan yang sudah tersimpan tetap terbaca.
 */
const PREFERRED_AGENT_KEY = "kcg-home-agent-type";

/** Agent pilihan terakhir; default `opencode` (juga saat storage tak tersedia). */
export function readPreferredAgentType(): AgentType {
  try {
    const saved =
      typeof localStorage === "undefined" ? null : localStorage.getItem(PREFERRED_AGENT_KEY);
    return saved === "claude-code" ? "claude-code" : "opencode";
  } catch {
    return "opencode";
  }
}

/** Simpan agent pilihan; diam saja bila storage tak tersedia (mode privat). */
export function storePreferredAgentType(agentType: AgentType): void {
  try {
    localStorage.setItem(PREFERRED_AGENT_KEY, agentType);
  } catch {
    // Pilihan tetap berlaku untuk kunjungan ini.
  }
}

/**
 * Query string `?agent=` untuk daftar model/agent Project. opencode tanpa
 * query (default server) agar URL lama tidak berubah.
 */
export function agentQuery(agentType: AgentType): string {
  return agentType === "claude-code" ? "?agent=claude-code" : "";
}
