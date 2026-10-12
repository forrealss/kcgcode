/**
 * Config_File & validasi Sandbox_Root saat startup.
 * Sesuai `design.md` — `config.ts`.
 *
 * Skema minimal: `{ "sandboxRoot": "/abs/path" }`, opsional `"port": 3000`.
 * Path default mengikuti mode runtime (`src/runtime.ts`):
 * - **cli** (`kcgcode`): `~/.kcgcode/config.json`
 * - **dev** (`bun dev`): `./kcg-code.config.json` bila ada, else user config
 * `loadConfig()` keluar dengan kode error bila `sandboxRoot` tidak diatur
 * atau direktori yang ditunjuk tidak ditemukan (Requirement 10.1).
 */
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { DEFAULT_CONFIG_PATH, resolveEffectiveConfigPath } from "./paths";
import type { Result } from "./server/result";

export { DEFAULT_CONFIG_PATH };

export interface AppConfig {
  /** Path absolut hasil `realpath` dari `sandboxRoot`. */
  sandboxRoot: string;
  /** Path berkas konfigurasi yang dibaca. */
  configPath: string;
  /** Port HTTP pilihan user (diatur lewat menu CLI); kosong = default. */
  port?: number;
}

export function isValidPort(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n > 0 && n <= 65535;
}

/**
 * Membaca dan memvalidasi Config_File tanpa menghentikan proses.
 * Dipisah dari `loadConfig()` agar dapat diuji secara unit (task 2.2).
 */
export function resolveConfig(configPath?: string): Result<AppConfig> {
  const file = resolveEffectiveConfigPath(configPath);

  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    return {
      ok: false,
      error: `[config] cannot read config file "${file}": ${(err as Error).message}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      error: `[config] invalid JSON in "${file}": ${(err as Error).message}`,
    };
  }

  const obj = parsed as Record<string, unknown>;
  const sandboxRoot = obj.sandboxRoot;
  if (typeof sandboxRoot !== "string" || sandboxRoot.trim() === "") {
    return {
      ok: false,
      error: `[config] "sandboxRoot" is not set in "${file}"`,
    };
  }

  let resolved: string;
  try {
    resolved = realpathSync(sandboxRoot);
  } catch (err) {
    return {
      ok: false,
      error: `[config] sandboxRoot directory not found: ${sandboxRoot} (${(err as Error).message})`,
    };
  }

  const port = obj.port;
  if (port !== undefined && !isValidPort(port)) {
    return {
      ok: false,
      error: `[config] "port" must be an integer 1-65535 in "${file}" (got ${JSON.stringify(port)})`,
    };
  }

  return {
    ok: true,
    data: { sandboxRoot: resolved, configPath: file, ...(port !== undefined && { port }) },
  };
}

/** Simpan `port` ke Config_File; key lain dipertahankan apa adanya. */
export function saveConfigPort(configPath: string, port: number): Result<void> {
  try {
    const obj = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    obj.port = port;
    writeFileSync(configPath, `${JSON.stringify(obj, null, 2)}\n`, "utf8");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: `cannot save port to "${configPath}": ${(err as Error).message}` };
  }
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
