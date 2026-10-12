import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveConfig, saveConfigPort } from "../../config";
import { choosePort, portIsFree, requestedPort } from "../port";

describe("requestedPort", () => {
  test("prioritas flag > env > config > default", () => {
    expect(requestedPort({ flag: 1, env: "2", config: 3 })).toEqual({ port: 1, source: "flag" });
    expect(requestedPort({ env: "2", config: 3 })).toEqual({ port: 2, source: "env" });
    expect(requestedPort({ env: "abc", config: 3 })).toEqual({ port: 3, source: "config" });
    expect(requestedPort({})).toEqual({ port: 3000, source: "default" });
  });
});

describe("choosePort", () => {
  const busy = (taken: number[]) => (_h: string, p: number) => !taken.includes(p);

  test("port kosong dipakai apa adanya", async () => {
    expect(await choosePort("127.0.0.1", { port: 3000, source: "default" }, busy([]))).toEqual({
      ok: true,
      port: 3000,
      fallbackFrom: null,
    });
  });

  test("default/config terpakai → pindah ke port kosong berikutnya", async () => {
    expect(
      await choosePort("127.0.0.1", { port: 3000, source: "default" }, busy([3000, 3001])),
    ).toEqual({
      ok: true,
      port: 3002,
      fallbackFrom: 3000,
    });
    expect(
      await choosePort("127.0.0.1", { port: 4000, source: "config" }, busy([4000])),
    ).toMatchObject({
      ok: true,
      port: 4001,
    });
  });

  test("port eksplisit terpakai → error, tanpa fallback", async () => {
    const res = await choosePort("127.0.0.1", { port: 3000, source: "flag" }, busy([3000]));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("--port");
  });

  test("portIsFree mendeteksi port yang sedang dipakai", async () => {
    const s = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
    try {
      expect(await portIsFree("127.0.0.1", s.port as number)).toBe(false);
    } finally {
      s.stop(true);
    }
  });
});

describe("config port", () => {
  let dir = "";
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("saveConfigPort menyimpan port & mempertahankan key lain", () => {
    dir = mkdtempSync(path.join(tmpdir(), "kcg-port-"));
    const file = path.join(dir, "config.json");
    writeFileSync(file, JSON.stringify({ sandboxRoot: dir, extra: true }));

    expect(saveConfigPort(file, 4321).ok).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      sandboxRoot: dir,
      extra: true,
      port: 4321,
    });

    const cfg = resolveConfig(file);
    expect(cfg.ok && cfg.data.port).toBe(4321);
  });

  test("port tidak valid di config ditolak", () => {
    dir = mkdtempSync(path.join(tmpdir(), "kcg-port-"));
    const file = path.join(dir, "config.json");
    writeFileSync(file, JSON.stringify({ sandboxRoot: dir, port: "abc" }));
    expect(resolveConfig(file).ok).toBe(false);
  });
});
