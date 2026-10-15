/**
 * Instalasi skill lewat CLI `skills` di direktori Project: validasi, kunci
 * per Project (instalasi paralel ditolak), streaming log yang dibersihkan,
 * serta pemetaan timeout/pembatalan/exit code ke kode error.
 */
import type { AgentType } from "../../../types";
import type { Result } from "../../result";
import { buildInstallArgs, cleanOutputLine, parseInstallOutput } from "./cli";
import type { InstallResult, SkillsRegistry, SpawnFn } from "./types";
import { isValidSkillId, isValidSource } from "./validation";

/** Instalasi mengunduh repo — beri waktu longgar. */
const INSTALL_TIMEOUT_MS = 180_000;

/** Buat fungsi `install` dengan kunci per Project miliknya sendiri. */
export function createSkillInstaller(spawn: SpawnFn): SkillsRegistry["install"] {
  const installing = new Set<string>();

  return async function install(
    projectPath: string,
    source: string,
    skillId: string,
    onLine?: (line: string) => void,
    signal?: AbortSignal,
    agentTypes: readonly AgentType[] = ["opencode"],
  ): Promise<Result<InstallResult>> {
    if (!isValidSource(source) || !isValidSkillId(skillId)) {
      return { ok: false, error: "INVALID_SKILL_ID" };
    }
    if (installing.has(projectPath)) return { ok: false, error: "SKILL_INSTALL_IN_PROGRESS" };
    installing.add(projectPath);
    // Baris kosong beruntun dirapatkan agar log tetap ringkas.
    let lastBlank = true;
    const emit = (raw: string) => {
      if (!onLine) return;
      const line = cleanOutputLine(raw);
      const blank = line.trim() === "";
      if (blank && lastBlank) return;
      lastBlank = blank;
      onLine(line);
    };
    try {
      const args = buildInstallArgs(source, skillId, agentTypes);
      emit(`$ ${args.join(" ")}`);
      const res = await spawn(args, projectPath, INSTALL_TIMEOUT_MS, emit, signal);
      if (signal?.aborted) {
        emit("Cancelled.");
        return { ok: false, error: "SKILL_INSTALL_CANCELLED" };
      }
      if (res.exitCode !== 0) {
        console.error(
          `[kcg-code] skills add ${source} --skill ${skillId} gagal (exit ${res.exitCode}):`,
          res.stderr.slice(-2000),
        );
        if (res.exitCode === null) {
          emit(`Timed out after ${Math.round(INSTALL_TIMEOUT_MS / 1000)}s — process stopped.`);
          return { ok: false, error: "SKILL_INSTALL_TIMEOUT" };
        }
        emit(`Process exited with code ${res.exitCode}.`);
        return { ok: false, error: "SKILL_INSTALL_FAILED" };
      }
      return parseInstallOutput(res.stdout, skillId);
    } catch (e) {
      console.error("[kcg-code] skills add error:", e);
      emit(`Error: ${(e as Error).message}`);
      return { ok: false, error: "SKILL_INSTALL_FAILED" };
    } finally {
      installing.delete(projectPath);
    }
  };
}
