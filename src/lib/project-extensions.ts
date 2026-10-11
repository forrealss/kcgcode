/**
 * Helper tampilan panel samping halaman Project (MCP & skill) — logika murni
 * tanpa DOM, dipisah agar dapat diuji `bun test`.
 */
import { AGENT_TYPES } from "@/lib/agent-types";
import type {
  McpServerInfo,
  McpStatus,
  SkillInfo,
  SkillSource,
} from "@/server/services/opencode-client";
import type { AgentType } from "@/types";

/** Label status MCP untuk UI. */
export const MCP_STATUS_LABEL: Record<McpStatus, string> = {
  connected: "Connected",
  disabled: "Disabled",
  failed: "Failed",
  needs_auth: "Needs auth",
  needs_client_registration: "Needs registration",
  unknown: "Unknown",
};

/** Warna titik status MCP (sepadan dengan titik status Session). */
export const MCP_STATUS_DOT: Record<McpStatus, string> = {
  connected: "bg-emerald-500",
  disabled: "bg-muted-foreground/40",
  failed: "bg-destructive",
  needs_auth: "bg-amber-500",
  needs_client_registration: "bg-amber-500",
  unknown: "bg-muted-foreground/40",
};

/** Ringkasan singkat untuk header seksi MCP ("2 of 3 connected"). */
export function describeMcpSummary(servers: readonly McpServerInfo[]): string {
  if (servers.length === 0) return "None configured";
  const connected = servers.filter((s) => s.status === "connected").length;
  return `${connected} of ${servers.length} connected`;
}

/** Urutan perhatian status MCP: yang bermasalah lebih dulu. */
const MCP_ATTENTION: Record<McpStatus, number> = {
  failed: 0,
  needs_auth: 1,
  needs_client_registration: 1,
  connected: 2,
  unknown: 3,
  disabled: 4,
};

/** Satu MCP server (per nama) beserta statusnya di tiap agent yang memakainya. */
export interface McpServerEntry {
  name: string;
  /** Status per agent; hanya agent yang mengonfigurasi server ini. */
  byAgent: Partial<Record<AgentType, McpServerInfo>>;
  /** Agent pemakai, urut `AGENT_TYPES`. */
  agents: AgentType[];
  /** Status paling butuh perhatian di antara agent (untuk ikon & urutan). */
  status: McpStatus;
}

/**
 * Gabungkan daftar MCP per agent menjadi satu daftar per nama server,
 * terurut: bermasalah dulu, lalu nama. Murni — diuji.
 */
export function mergeMcpServers(
  byAgent: Partial<Record<AgentType, readonly McpServerInfo[]>>,
): McpServerEntry[] {
  const merged = new Map<string, McpServerEntry>();
  for (const agent of AGENT_TYPES) {
    for (const server of byAgent[agent] ?? []) {
      const entry = merged.get(server.name) ?? {
        name: server.name,
        byAgent: {},
        agents: [],
        status: server.status,
      };
      entry.byAgent[agent] = server;
      entry.agents.push(agent);
      if (MCP_ATTENTION[server.status] < MCP_ATTENTION[entry.status]) entry.status = server.status;
      merged.set(server.name, entry);
    }
  }
  return [...merged.values()].sort(
    (a, b) => MCP_ATTENTION[a.status] - MCP_ATTENTION[b.status] || a.name.localeCompare(b.name),
  );
}

/**
 * Ringkasan header seksi MCP gabungan: berapa server yang tersambung di
 * setidaknya satu agent ("1 of 2 connected").
 */
export function describeMcpEntries(entries: readonly McpServerEntry[]): string {
  if (entries.length === 0) return "None configured";
  const connected = entries.filter((e) =>
    Object.values(e.byAgent).some((s) => s?.status === "connected"),
  ).length;
  return `${connected} of ${entries.length} connected`;
}

/** Label asal skill. */
export const SKILL_SOURCE_LABEL: Record<SkillSource, string> = {
  project: "This project",
  global: "Global",
  builtin: "Built-in",
};

export interface SkillGroup<T extends SkillInfo = SkillInfo> {
  source: SkillSource;
  label: string;
  skills: T[];
}

/**
 * Kelompokkan skill per asal: Project dulu (paling relevan), lalu global,
 * lalu bawaan. Kelompok kosong dibuang; urutan dalam kelompok dipertahankan.
 */
export function groupSkills<T extends SkillInfo>(skills: readonly T[]): SkillGroup<T>[] {
  const order: SkillSource[] = ["project", "global", "builtin"];
  return order
    .map((source) => ({
      source,
      label: SKILL_SOURCE_LABEL[source],
      skills: skills.filter((s) => s.source === source),
    }))
    .filter((g) => g.skills.length > 0);
}

/** Filter skill berdasarkan kata kunci (nama atau deskripsi, case-insensitive). */
export function filterSkills<T extends SkillInfo>(skills: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [...skills];
  return skills.filter(
    (s) => s.name.toLowerCase().includes(q) || (s.description ?? "").toLowerCase().includes(q),
  );
}
