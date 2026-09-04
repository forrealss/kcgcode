/**
 * Config_File & validasi Sandbox_Root saat startup.
 * Sesuai `design.md` — `config.ts`.
 *
 * Skema minimal: `{ "sandboxRoot": "/abs/path" }`.
 * `loadConfig()` keluar dengan kode error bila `sandboxRoot` tidak diatur
 * atau direktori yang ditunjuk tidak ditemukan (Requirement 10.1).
 */
import { readFileSync, realpathSync } from "node:fs";
import type { Result } from "./server/result";

export const DEFAULT_CONFIG_PATH = "kcg-bridge.config.json";

export interface AppConfig {
  /** Path absolut hasil `realpath` dari `sandboxRoot`. */
  sandboxRoot: string;
  /** Path berkas konfigurasi yang dibaca. */
  configPath: string;
}

/**
 * Membaca dan memvalidasi Config_File tanpa menghentikan proses.
 * Dipisah dari `loadConfig()` agar dapat diuji secara unit (task 2.2).
 */
export function resolveConfig(configPath?: string): Result<AppConfig> {
  const file = configPath ?? process.env.KCG_CONFIG_PATH ?? DEFAULT_CONFIG_PATH;

  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    return {
      ok: false,
      error: `[config] tidak dapat membaca berkas konfigurasi "${file}": ${(err as Error).message}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      error: `[config] JSON tidak valid di "${file}": ${(err as Error).message}`,
    };
  }

  const obj = parsed as Record<string, unknown>;
  const sandboxRoot = obj.sandboxRoot;
  if (typeof sandboxRoot !== "string" || sandboxRoot.trim() === "") {
    return {
      ok: false,
      error: `[config] field "sandboxRoot" tidak diatur di "${file}"`,
    };
  }

  let resolved: string;
  try {
    resolved = realpathSync(sandboxRoot);
  } catch (err) {
    return {
      ok: false,
      error: `[config] direktori sandboxRoot tidak ditemukan: ${sandboxRoot} (${(err as Error).message})`,
    };
  }

  return { ok: true, data: { sandboxRoot: resolved, configPath: file } };
}

/**
 * Memuat konfigurasi saat startup. Bila tidak valid, log pesan jelas dan
 * proses keluar dengan kode error (Requirement 10.1).
 */
export function loadConfig(): AppConfig {
  const res = resolveConfig();
  if (!res.ok) {
    console.error(res.error);
    process.exit(1);
  }
  return res.data;
}
