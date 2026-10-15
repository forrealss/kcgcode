/**
 * Daftar per agent (OpenCode & Claude Code) dari satu endpoint `?agent=` —
 * logika murni di balik `hooks/useAgentLists.ts`, dipisah agar dapat diuji
 * `bun test`. Satu agent gagal dibaca tidak menggagalkan yang lain.
 */
import { AGENT_TYPE_LABELS, AGENT_TYPES } from "@/lib/agent-types";
import { errorText } from "@/lib/api";
import type { AgentType } from "@/types";

/** Agent yang gagal dibaca beserta pesan error-nya. */
export interface AgentFailure {
  agent: AgentType;
  message: string;
}

/** Hasil per agent; `failed` = agent yang gagal dibaca (yang lain tetap tampil). */
export interface AgentLists<T> {
  byAgent: Partial<Record<AgentType, T[]>>;
  failed: AgentFailure[];
}

/**
 * Susun hasil `Promise.allSettled` (urut `AGENT_TYPES`) menjadi daftar per
 * agent. Pesan error selain `ApiError` memakai `fallback`.
 */
export function collectAgentLists<T>(
  results: readonly PromiseSettledResult<T[]>[],
  fallback: string,
): AgentLists<T> {
  const data: AgentLists<T> = { byAgent: {}, failed: [] };
  results.forEach((r, i) => {
    const agent = AGENT_TYPES[i] as AgentType;
    if (r.status === "fulfilled") data.byAgent[agent] = r.value;
    else data.failed.push({ agent, message: errorText(r.reason, fallback) });
  });
  return data;
}

/** Ganti daftar satu agent (mis. balasan aksi) sekaligus hapus status gagalnya. */
export function replaceAgentList<T>(
  lists: AgentLists<T>,
  agent: AgentType,
  items: T[],
): AgentLists<T> {
  return {
    byAgent: { ...lists.byAgent, [agent]: items },
    failed: lists.failed.filter((f) => f.agent !== agent),
  };
}

/** Ringkasan agent yang gagal dibaca: "Couldn't read OpenCode, Claude Code". */
export function describeFailedAgents(failed: readonly AgentFailure[]): string {
  return `Couldn't read ${failed.map((f) => AGENT_TYPE_LABELS[f.agent]).join(", ")}`;
}
