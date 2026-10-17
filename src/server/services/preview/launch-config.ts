/**
 * Resolusi perintah dev server sebuah Project untuk fitur Preview.
 *
 * Prioritas:
 * 1. `.claude/launch.json` (format yang sama dengan Claude desktop):
 *    konfigurasi pertama dengan `runtimeExecutable`.
 * 2. Script `dev` (atau `start`) di `package.json`, dijalankan dengan package
 *    manager yang terdeteksi dari lockfile.
 *
 * Perintah tidak pernah dijalankan otomatis: UI menampilkannya dan pengguna
 * menekan Start (itulah persetujuannya), karena file ini bisa ditulis agent.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface LaunchConfig {
  /** Asal config (ditampilkan di UI). */
  source: "launch.json" | "package.json";
  /** Nama konfigurasi / script. */
  name: string;
  /** argv lengkap: `[executable, ...args]`. */
  argv: string[];
  /** Port yang dideklarasikan config (launch.json `port`); null = deteksi dari log. */
  port: number | null;
  /** Direktori kerja absolut. */
  cwd: string;
}

function readJsonFile(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function validPort(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 65535 ? v : null;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function fromLaunchJson(projectPath: string): LaunchConfig | null {
  const data = readJsonFile(path.join(projectPath, ".claude", "launch.json"));
  if (!data || typeof data !== "object") return null;
  const configs = (data as { configurations?: unknown }).configurations;
  if (!Array.isArray(configs)) return null;
  for (const c of configs) {
    if (!c || typeof c !== "object") continue;
    const cfg = c as Record<string, unknown>;
    const exe = cfg.runtimeExecutable;
    if (typeof exe !== "string" || exe.trim() === "") continue;
    const args = isStringArray(cfg.runtimeArgs) ? cfg.runtimeArgs : [];
    // `cwd` relatif terhadap Project; tidak boleh keluar dari folder Project.
    let cwd = projectPath;
    if (typeof cfg.cwd === "string" && cfg.cwd.trim() !== "") {
      const resolved = path.resolve(projectPath, cfg.cwd);
      const rel = path.relative(projectPath, resolved);
      if (rel.startsWith("..") || path.isAbsolute(rel)) continue;
      cwd = resolved;
    }
    return {
      source: "launch.json",
      name: typeof cfg.name === "string" && cfg.name.trim() !== "" ? cfg.name : exe,
      argv: [exe, ...args],
      port: validPort(cfg.port),
      cwd,
    };
  }
  return null;
}

/** Package manager dari lockfile (default npm). */
export function detectPackageManager(projectPath: string): "bun" | "pnpm" | "yarn" | "npm" {
  const has = (f: string) => existsSync(path.join(projectPath, f));
  if (has("bun.lock") || has("bun.lockb")) return "bun";
  if (has("pnpm-lock.yaml")) return "pnpm";
  if (has("yarn.lock")) return "yarn";
  return "npm";
}

function fromPackageJson(projectPath: string): LaunchConfig | null {
  const pkg = readJsonFile(path.join(projectPath, "package.json"));
  if (!pkg || typeof pkg !== "object") return null;
  const scripts = (pkg as { scripts?: unknown }).scripts;
  if (!scripts || typeof scripts !== "object") return null;
  const s = scripts as Record<string, unknown>;
  const name = typeof s.dev === "string" ? "dev" : typeof s.start === "string" ? "start" : null;
  if (!name) return null;
  return {
    source: "package.json",
    name,
    argv: [detectPackageManager(projectPath), "run", name],
    port: null,
    cwd: projectPath,
  };
}

/** Config dev server Project, atau null bila tidak ada yang bisa dipakai. */
export function resolveLaunchConfig(projectPath: string): LaunchConfig | null {
  return fromLaunchJson(projectPath) ?? fromPackageJson(projectPath);
}

/** Tampilan perintah untuk UI (bukan untuk dieksekusi ulang lewat shell). */
export function formatCommand(argv: string[]): string {
  return argv.map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : JSON.stringify(a))).join(" ");
}
