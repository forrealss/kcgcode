/**
 * Path paket & direktori data — perilaku beda per mode runtime:
 *
 * |                | dev (`bun dev`)              | cli (`kcgcode` global)      |
 * |----------------|------------------------------|-----------------------------|
 * | config         | `./kcg-code.config.json` dulu | `~/.kcgcode/config.json`   |
 * | db / uploads   | `./data/...`                 | `~/.kcgcode/data/...`       |
 * | sandbox default| `./sandbox` saat init        | `~/.kcgcode/sandbox`        |
 *
 * Explicit `--config` / `KCG_CONFIG_PATH` / `KCG_DB_PATH` selalu menang.
 */
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { isCliMode } from "./runtime";

/** Root direktori paket kcgcode (tempat package.json berada). */
export const PACKAGE_ROOT = path.resolve(import.meta.dir, "..");

/** Direktori asset statis PWA di dalam paket. */
export const PUBLIC_DIR = path.join(PACKAGE_ROOT, "public");

/** Direktori aplikasi milik user: `~/.kcgcode`. */
export const KCG_HOME = path.join(homedir(), ".kcgcode");

/** Config milik user (CLI global): `~/.kcgcode/config.json`. */
export const USER_CONFIG_PATH = path.join(KCG_HOME, "config.json");

/** SQLite milik user (CLI global). */
export const USER_DB_PATH = path.join(KCG_HOME, "data", "kcg-code.sqlite");

/** Uploads milik user (CLI global). */
export const USER_UPLOADS_DIR = path.join(KCG_HOME, "data", "uploads");

/** Sandbox default milik user (CLI global). */
export const USER_SANDBOX_DIR = path.join(KCG_HOME, "sandbox");

/** Config lokal di cwd (dev). */
export const LOCAL_CONFIG_NAME = "kcg-code.config.json";

/** SQLite lokal di cwd (dev): `./data/kcg-code.sqlite`. */
export const LOCAL_DB_PATH = path.resolve("data", "kcg-code.sqlite");

/** Uploads lokal di cwd (dev). */
export const LOCAL_UPLOADS_DIR = path.resolve("data", "uploads");

/** Default config sesuai mode runtime. */
export function defaultConfigPath(): string {
  return isCliMode() ? USER_CONFIG_PATH : path.resolve(LOCAL_CONFIG_NAME);
}

/** Default SQLite sesuai mode runtime. */
export function defaultDbPath(): string {
  return isCliMode() ? USER_DB_PATH : LOCAL_DB_PATH;
}

/** Default uploads sesuai mode runtime. */
export function defaultUploadsDir(): string {
  return isCliMode() ? USER_UPLOADS_DIR : LOCAL_UPLOADS_DIR;
}

/** Default sandbox (init) sesuai mode runtime. */
export function defaultSandboxDir(): string {
  return isCliMode() ? USER_SANDBOX_DIR : path.resolve("sandbox");
}

/** Back-compat alias (dipakai kode lama / dashboard). */
export const DEFAULT_CONFIG_PATH = USER_CONFIG_PATH;
export const DEFAULT_DB_PATH = USER_DB_PATH;
export const DEFAULT_UPLOADS_DIR = USER_UPLOADS_DIR;
export const DEFAULT_SANDBOX_DIR = USER_SANDBOX_DIR;

/** Buat `~/.kcgcode` (dan subfolder data) bila belum ada. */
export function ensureKcgHome(): string {
  mkdirSync(KCG_HOME, { recursive: true });
  mkdirSync(path.join(KCG_HOME, "data"), { recursive: true });
  return KCG_HOME;
}

/**
 * Path config efektif:
 * 1. arg eksplisit / `KCG_CONFIG_PATH`
 * 2. **cli**: `~/.kcgcode/config.json` (abaikan cwd)
 * 3. **dev**: `./kcg-code.config.json` bila ada, else user config
 */
export function resolveEffectiveConfigPath(explicit?: string): string {
  if (explicit && explicit.trim() !== "") return path.resolve(explicit);
  const env = process.env.KCG_CONFIG_PATH;
  if (env && env.trim() !== "") return path.resolve(env);

  if (isCliMode()) {
    return USER_CONFIG_PATH;
  }

  const local = path.resolve(LOCAL_CONFIG_NAME);
  if (existsSync(local)) return local;
  return USER_CONFIG_PATH;
}

/** Path SQLite efektif: `KCG_DB_PATH` > default mode. */
export function resolveEffectiveDbPath(): string {
  const env = process.env.KCG_DB_PATH;
  if (env && env.trim() !== "") return path.resolve(env);
  return defaultDbPath();
}

/** Path uploads efektif (belum ada env override). */
export function resolveEffectiveUploadsDir(): string {
  return defaultUploadsDir();
}
