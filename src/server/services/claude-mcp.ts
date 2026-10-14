/**
 * Daftar MCP server Claude Code — dibaca dari config di disk.
 *
 * Status MCP Claude Code hanya diketahui dari proses `claude` yang sedang
 * berjalan (`mcpServerStatus()` / pesan `system/init`). Tanpa proses itu
 * daftarnya kosong, padahal server sudah dikonfigurasi. Modul ini membaca
 * NAMA server dari lokasi yang sama dengan CLI `claude` (isi config — env,
 * header, token — tidak pernah dibaca keluar):
 * - project : `<project>/.mcp.json` -> `mcpServers`
 * - local   : `<config>/.claude.json` -> `projects[<path>].mcpServers`
 * - user    : `<config>/.claude.json` -> `mcpServers`
 * `<config>` = `CLAUDE_CONFIG_DIR` bila diset, selain itu `HOME` dari env
 * proses `claude` (fallback home user OS).
 *
 * Server `.mcp.json` yang ditolak user (`disabledMcpjsonServers`) bertanda
 * `disabled`; lainnya `unknown` sampai status live tersedia
 * (`mergeClaudeMcp`).
 */
import { homedir } from "node:os";
import { join } from "node:path";
import type { McpServerInfo } from "../../types";

export type ClaudeMcpScope = "project" | "local" | "user";

export interface ClaudeMcpConfigEntry {
  name: string;
  scope: ClaudeMcpScope;
  /** Server `.mcp.json` yang ditolak user di Claude Code. */
  disabled: boolean;
}

/** Path `.claude.json` untuk `env` tertentu. */
export function claudeJsonPath(env: Record<string, string | undefined>): string {
  const configDir = env.CLAUDE_CONFIG_DIR?.trim();
  if (configDir) return join(configDir, ".claude.json");
  return join(env.HOME?.trim() || homedir(), ".claude.json");
}

function serverNames(value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  return Object.keys(value).filter((k) => k !== "");
}

function stringList(value: unknown): Set<string> {
  return new Set(Array.isArray(value) ? value.filter((v) => typeof v === "string") : []);
}

/**
 * Gabungkan isi `.mcp.json` dan `.claude.json` (sudah di-parse) menjadi
 * daftar unik per nama. Prioritas sama dengan Claude Code: local > project >
 * user. Murni — diuji.
 */
export function parseClaudeMcpConfig(
  projectPath: string,
  mcpJson: unknown,
  claudeJson: unknown,
): ClaudeMcpConfigEntry[] {
  const root = (typeof claudeJson === "object" && claudeJson !== null ? claudeJson : {}) as {
    mcpServers?: unknown;
    projects?: Record<string, unknown>;
  };
  const projectState = (root.projects?.[projectPath.replace(/\/+$/, "")] ?? {}) as {
    mcpServers?: unknown;
    disabledMcpjsonServers?: unknown;
  };
  const rejected = stringList(projectState.disabledMcpjsonServers);

  const byName = new Map<string, ClaudeMcpConfigEntry>();
  const add = (names: string[], scope: ClaudeMcpScope) => {
    for (const name of names) {
      if (!byName.has(name)) {
        byName.set(name, { name, scope, disabled: scope === "project" && rejected.has(name) });
      }
    }
  };
  add(serverNames(projectState.mcpServers), "local");
  add(serverNames((mcpJson as { mcpServers?: unknown } | null)?.mcpServers), "project");
  add(serverNames(root.mcpServers), "user");
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function readJson(path: string): Promise<unknown> {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    return await file.json();
  } catch {
    // File rusak / tak terbaca — anggap tidak ada server dari sumber ini.
    return null;
  }
}

/** Baca config MCP Claude Code untuk sebuah Project dari disk. */
export async function readClaudeMcpConfig(
  projectPath: string,
  env: Record<string, string | undefined>,
): Promise<ClaudeMcpConfigEntry[]> {
  const [mcpJson, claudeJson] = await Promise.all([
    readJson(join(projectPath, ".mcp.json")),
    readJson(claudeJsonPath(env)),
  ]);
  return parseClaudeMcpConfig(projectPath, mcpJson, claudeJson);
}

/**
 * Daftar akhir: server dari config + status live bila ada. Server live yang
 * tidak ada di config (plugin, konektor claude.ai) tetap ikut. Murni — diuji.
 */
export function mergeClaudeMcp(
  configured: readonly ClaudeMcpConfigEntry[],
  live: readonly McpServerInfo[],
): McpServerInfo[] {
  const liveByName = new Map(live.map((s) => [s.name, s]));
  const out: McpServerInfo[] = configured.map((c) => {
    const hit = liveByName.get(c.name);
    if (hit) return hit;
    return { name: c.name, status: c.disabled ? "disabled" : "unknown", error: null };
  });
  const known = new Set(configured.map((c) => c.name));
  for (const s of live) if (!known.has(s.name)) out.push(s);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
