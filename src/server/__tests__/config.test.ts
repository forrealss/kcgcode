/**
 * Unit test `config.ts` (task 2.2).
 * Kasus: field `sandboxRoot` hilang, direktori tidak ditemukan,
 * dan konfigurasi valid. Requirement 10.1.
 */
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveConfig } from "../config";

function makeTempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "kcg-config-"));
}

test("config: field sandboxRoot hilang -> error", () => {
  const dir = makeTempDir();
  const cfgPath = path.join(dir, "kcg-bridge.config.json");
  writeFileSync(cfgPath, JSON.stringify({}), "utf8");
  const res = resolveConfig(cfgPath);
  expect(res.ok).toBe(false);
  if (!res.ok) {
    expect(res.error).toContain("sandboxRoot");
  }
});

test("config: direktori sandboxRoot tidak ditemukan -> error", () => {
  const dir = makeTempDir();
  const cfgPath = path.join(dir, "kcg-bridge.config.json");
  const missing = path.join(dir, "tidak-ada");
  writeFileSync(cfgPath, JSON.stringify({ sandboxRoot: missing }), "utf8");
  const res = resolveConfig(cfgPath);
  expect(res.ok).toBe(false);
  if (!res.ok) {
    expect(res.error).toContain("tidak ditemukan");
  }
});

test("config: berkas tidak ada -> error", () => {
  const dir = makeTempDir();
  const res = resolveConfig(path.join(dir, "missing.json"));
  expect(res.ok).toBe(false);
});

test("config: JSON tidak valid -> error", () => {
  const dir = makeTempDir();
  const cfgPath = path.join(dir, "kcg-bridge.config.json");
  writeFileSync(cfgPath, "{ not valid json", "utf8");
  const res = resolveConfig(cfgPath);
  expect(res.ok).toBe(false);
});

test("config: konfigurasi valid -> sandboxRoot ter-resolve", () => {
  const dir = makeTempDir();
  const sandbox = path.join(dir, "sandbox");
  mkdirSync(sandbox, { recursive: true });
  const cfgPath = path.join(dir, "kcg-bridge.config.json");
  writeFileSync(cfgPath, JSON.stringify({ sandboxRoot: sandbox }), "utf8");

  const res = resolveConfig(cfgPath);
  expect(res.ok).toBe(true);
  if (res.ok) {
    expect(res.data.sandboxRoot).toBe(sandbox);
    expect(res.data.configPath).toBe(cfgPath);
  }
});

test("config: loadConfig keluar dengan kode error saat konfigurasi tidak valid", () => {
  const dir = makeTempDir();
  const cfgPath = path.join(dir, "bad.json");
  writeFileSync(cfgPath, JSON.stringify({}), "utf8");

  const modulePath = path.join(process.cwd(), "src/server/config.ts");
  const script = `import { loadConfig } from ${JSON.stringify(modulePath)}; loadConfig();`;
  const proc = Bun.spawnSync(["bun", "-e", script], {
    env: { ...process.env, KCG_CONFIG_PATH: cfgPath },
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(proc.exitCode).toBe(1);
});

test("config: loadConfig berhasil saat konfigurasi valid", () => {
  const dir = makeTempDir();
  const sandbox = path.join(dir, "sandbox");
  mkdirSync(sandbox, { recursive: true });
  const cfgPath = path.join(dir, "ok.json");
  writeFileSync(cfgPath, JSON.stringify({ sandboxRoot: sandbox }), "utf8");

  const modulePath = path.join(process.cwd(), "src/server/config.ts");
  const script = `import { loadConfig } from ${JSON.stringify(modulePath)}; const c = loadConfig(); console.log(c.sandboxRoot);`;
  const proc = Bun.spawnSync(["bun", "-e", script], {
    env: { ...process.env, KCG_CONFIG_PATH: cfgPath },
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(proc.exitCode).toBe(0);
  expect(proc.stdout.toString()).toContain(sandbox);
});
