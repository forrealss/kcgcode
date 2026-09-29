/**
 * Helper tampilan panel samping halaman Project (MCP & skill) — logika murni
 * tanpa DOM, dipisah agar dapat diuji `bun test`.
 */
import type {
  McpServerInfo,
  McpStatus,
  SkillInfo,
  SkillSource,
} from "@/server/services/opencode-client";

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

/** Label asal skill. */
export const SKILL_SOURCE_LABEL: Record<SkillSource, string> = {
  project: "This project",
  global: "Global",
  builtin: "Built-in",
};

export interface SkillGroup {
  source: SkillSource;
  label: string;
  skills: SkillInfo[];
}

/**
 * Kelompokkan skill per asal: Project dulu (paling relevan), lalu global,
 * lalu bawaan. Kelompok kosong dibuang; urutan dalam kelompok dipertahankan.
 */
export function groupSkills(skills: readonly SkillInfo[]): SkillGroup[] {
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
export function filterSkills(skills: readonly SkillInfo[], query: string): SkillInfo[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [...skills];
  return skills.filter(
    (s) => s.name.toLowerCase().includes(q) || (s.description ?? "").toLowerCase().includes(q),
  );
}
