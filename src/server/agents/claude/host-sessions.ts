/**
 * Jejak Session Claude Code milik aplikasi lain di mesin ini (di-mock pada
 * test):
 *
 * - Proses `claude` interaktif yang hidup menulis `<config>/sessions/<pid>.json`
 *   (`sessionId`, `cwd`, `entrypoint`, `name`). Session di sana sedang dipegang
 *   proses itu — melanjutkannya dari KCG berarti dua penulis pada satu
 *   transcript. Berkas proses yang sudah mati diabaikan, begitu pula proses
 *   SDK (`sdk-*`, termasuk proses milik KCG sendiri).
 * - Claude Desktop menyimpan metadata Session tab Code di
 *   `<desktop>/claude-code-sessions/<org>/<akun>/local_*.json` (`cliSessionId`,
 *   `title`) — sumber judul yang dilihat user di Desktop.
 *   Session Cowork disimpan terpisah (config per Session + path VM) dan
 *   tidak ikut.
 */
import { readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Proses Claude Code interaktif yang sedang memegang sebuah Session. */
export interface RunningClaudeSession {
  pid: number;
  /** `claude-desktop`, `cli`, … (apa adanya dari CLI). */
  entrypoint?: string;
  cwd?: string;
  /** Nama Session di proses itu (judul Desktop). */
  name?: string;
}

/** Metadata Session tab Code Claude Desktop. */
export interface DesktopSessionMeta {
  title?: string;
}

export interface ClaudeHostSessions {
  /** Session (id Claude Code) -> proses interaktif lain yang memegangnya. */
  running(): Promise<Map<string, RunningClaudeSession>>;
  /** id Session Claude Code -> metadata Claude Desktop. */
  desktop(): Promise<Map<string, DesktopSessionMeta>>;
}

type Env = Record<string, string | undefined>;

/** Direktori config Claude Code (`CLAUDE_CONFIG_DIR`, default `~/.claude`). */
export function claudeConfigDir(env: Env): string {
  return env.CLAUDE_CONFIG_DIR || path.join(env.HOME || os.homedir(), ".claude");
}

/** Direktori data Claude Desktop per platform. */
export function desktopDataDir(env: Env, platform: NodeJS.Platform = process.platform): string {
  const home = env.HOME || os.homedir();
  if (platform === "darwin") return path.join(home, "Library", "Application Support", "Claude");
  if (platform === "win32") {
    return path.join(env.APPDATA || path.join(home, "AppData", "Roaming"), "Claude");
  }
  return path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "Claude");
}

/** Proses `pid` masih hidup (EPERM = hidup milik user lain). */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    const v = await Bun.file(file).json();
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function list(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);

export function createHostSessions(
  env: Env,
  isAlive: (pid: number) => boolean = pidAlive,
): ClaudeHostSessions {
  return {
    async running() {
      const dir = path.join(claudeConfigDir(env), "sessions");
      const out = new Map<string, RunningClaudeSession>();
      for (const name of await list(dir)) {
        if (!/^\d+\.json$/.test(name)) continue;
        const info = await readJson(path.join(dir, name));
        const sessionId = str(info?.sessionId);
        const pid = typeof info?.pid === "number" ? info.pid : Number(name.slice(0, -5));
        const entrypoint = str(info?.entrypoint);
        if (!sessionId || entrypoint?.startsWith("sdk") || !isAlive(pid)) continue;
        out.set(sessionId, { pid, entrypoint, cwd: str(info?.cwd), name: str(info?.name) });
      }
      return out;
    },
    async desktop() {
      const root = path.join(desktopDataDir(env), "claude-code-sessions");
      const out = new Map<string, DesktopSessionMeta>();
      for (const org of await list(root)) {
        for (const account of await list(path.join(root, org))) {
          const dir = path.join(root, org, account);
          for (const name of await list(dir)) {
            if (!name.startsWith("local_") || !name.endsWith(".json")) continue;
            const meta = await readJson(path.join(dir, name));
            const id = str(meta?.cliSessionId);
            if (!id) continue;
            out.set(id, { title: str(meta?.title) });
          }
        }
      }
      return out;
    },
  };
}
