/**
 * Helper murni seputar CLI `skills`: argumen `bunx` (array — tanpa shell),
 * env proses, parsing stdout `--json`, dan pembersihan baris output.
 */
import type { AgentType } from "../../../types";
import type { Result } from "../../result";
import { str } from "./parsing";
import { type InstallResult, SKILLS_CLI_VERSION } from "./types";

/** Argumen `bunx` untuk instalasi (array — tanpa shell). */
export function buildInstallArgs(
  source: string,
  skillId: string,
  agentTypes: readonly AgentType[] = ["opencode"],
): string[] {
  return [
    "bunx",
    `skills@${SKILLS_CLI_VERSION}`,
    "add",
    source,
    "--skill",
    skillId,
    // Id agent CLI `skills` kebetulan sama dengan `AgentType`; beberapa
    // nilai setelah satu `--agent` diterima CLI.
    "--agent",
    ...agentTypes,
    "-y",
    "--json",
  ];
}

/**
 * Ambil hasil instalasi dari stdout `--json` (array hasil per skill).
 * CLI bisa mencetak teks lain sebelum JSON, jadi cari `[` pertama.
 */
export function parseInstallOutput(stdout: string, skillId: string): Result<InstallResult> {
  const start = stdout.indexOf("[");
  if (start === -1) return { ok: false, error: "SKILL_INSTALL_FAILED" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.slice(start));
  } catch {
    return { ok: false, error: "SKILL_INSTALL_FAILED" };
  }
  if (!Array.isArray(parsed)) return { ok: false, error: "SKILL_INSTALL_FAILED" };
  const entry = parsed.find(
    (e): e is Record<string, unknown> =>
      typeof e === "object" && e !== null && (e as { name?: unknown }).name === skillId,
  );
  const hit = entry ?? (parsed[0] as Record<string, unknown> | undefined);
  if (!hit || (hit.status !== "installed" && hit.status !== "updated")) {
    return { ok: false, error: "SKILL_INSTALL_FAILED" };
  }
  return { ok: true, data: { name: str(hit.name) ?? skillId, path: str(hit.path) } };
}

/** Hapus escape ANSI & karakter kontrol (selain tab) dari satu baris output. */
export function cleanOutputLine(raw: string): string {
  return (
    raw
      // biome-ignore lint/suspicious/noControlCharactersInRegex: memang menyaring escape ANSI
      .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: memang menyaring escape OSC
      .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: memang menyaring kontrol
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
      .trimEnd()
  );
}

/**
 * Env proses CLI. Selain mematikan telemetry/warna, `git` (dipakai CLI untuk
 * clone repo) dibuat gagal cepat alih-alih menggantung: tanpa prompt
 * kredensial (repo privat) dan batalkan transfer yang macet (< 1 KB/s
 * selama 30 detik).
 */
export function installEnv(base: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined) env[k] = v;
  return {
    ...env,
    DISABLE_TELEMETRY: "1",
    CI: "1",
    NO_COLOR: "1",
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
    GIT_HTTP_LOW_SPEED_LIMIT: "1000",
    GIT_HTTP_LOW_SPEED_TIME: "30",
  };
}
