import { afterEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { setRunMode } from "../../../runtime";
import {
  createSelfUpdater,
  detectUnsupported,
  type InstallerProcess,
  isBunGlobalPackage,
  milestoneFromLine,
  type SelfUpdaterOptions,
} from "../self-update";
import type { UpdateChecker, UpdateInfo } from "../update-check";

const UPDATE: UpdateInfo = {
  current: "0.9.0",
  latest: "0.10.0",
  command: "bun i -g kcg-code@latest",
};

function checker(update: UpdateInfo | null = UPDATE): UpdateChecker {
  return {
    available: () => update,
    start: async () => {},
    check: async () => update,
    close() {},
  };
}

function stream(text: string): ReadableStream<Uint8Array> {
  return new Response(text).body as ReadableStream<Uint8Array>;
}

/** Installer palsu: cetak `stdout`, keluar dengan `code`; catat perintahnya. */
function fakeSpawn(opts: { stdout?: string; code?: number; hang?: boolean } = {}) {
  const calls: string[][] = [];
  let killed = false;
  const spawn = (cmd: string[]): InstallerProcess => {
    calls.push(cmd);
    let resolveExit: (code: number) => void = () => {};
    const exited = opts.hang
      ? new Promise<number>((r) => {
          resolveExit = r;
        })
      : Promise.resolve(opts.code ?? 0);
    return {
      stdout: stream(opts.stdout ?? ""),
      stderr: stream(""),
      exited,
      kill() {
        killed = true;
        resolveExit(143);
      },
    };
  };
  return { spawn, calls, killed: () => killed };
}

const BUN_OUTPUT = [
  "bun add v1.4.0",
  "Resolving dependencies",
  "Resolved, downloaded and extracted [12]",
  "Saved lockfile",
  "",
  "installed kcg-code@0.10.0 with binaries:",
  " - kcgcode",
  "",
  "12 packages installed [1.20s]",
  "",
].join("\n");

function updater(overrides: Partial<SelfUpdaterOptions> = {}) {
  return createSelfUpdater({
    updates: checker(),
    runningSessions: () => [],
    unsupported: null,
    packageName: async () => "kcg-code",
    readInstalledVersion: async () => "0.10.0",
    bunPath: "/usr/bin/bun",
    cwd: "/tmp",
    restartDelayMs: 0,
    ...overrides,
  });
}

afterEach(() => setRunMode("dev"));

describe("deteksi dukungan", () => {
  test("paket di folder global Bun", () => {
    const g = path.join("/home/u/.bun/install/global/node_modules/kcg-code");
    expect(isBunGlobalPackage(g)).toBe(true);
    expect(isBunGlobalPackage("/usr/lib/node_modules/kcg-code")).toBe(false);
    expect(isBunGlobalPackage("/home/u/src/agent-bridger")).toBe(false);
  });

  test("bun dev -> NOT_CLI; cli di luar global Bun -> NOT_BUN_GLOBAL", () => {
    setRunMode("dev");
    expect(detectUnsupported("/home/u/.bun/install/global/node_modules/kcg-code")).toBe("NOT_CLI");
    setRunMode("cli");
    expect(detectUnsupported("/usr/lib/node_modules/kcg-code")).toBe("NOT_BUN_GLOBAL");
    expect(detectUnsupported("/home/u/.bun/install/global/node_modules/kcg-code")).toBeNull();
  });
});

test("tonggak output bun add -> progres naik", () => {
  expect(milestoneFromLine("Resolving dependencies")?.progress).toBe(20);
  expect(milestoneFromLine("Resolved, downloaded and extracted [12]")).toEqual({
    step: "linking",
    progress: 65,
  });
  expect(milestoneFromLine("Saved lockfile")?.progress).toBe(75);
  expect(milestoneFromLine("installed kcg-code@0.10.0 with binaries:")?.progress).toBe(85);
  expect(milestoneFromLine("12 packages installed [1.20s]")).toBeNull();
});

describe("instalasi", () => {
  test("sukses tanpa restart -> installed, perintah bun add versi persis", async () => {
    const fake = fakeSpawn({ stdout: BUN_OUTPUT });
    const u = updater({ spawn: fake.spawn });

    const res = await u.start("0.10.0");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.phase).toBe("installing");
    await u.settled();

    expect(fake.calls).toEqual([["/usr/bin/bun", "add", "-g", "kcg-code@0.10.0"]]);
    const st = await u.status();
    expect(st).toMatchObject({
      phase: "installed",
      target: "0.10.0",
      progress: 100,
      error: null,
      restart: "manual",
    });
    const log = u.logs(0);
    expect(log.lines[0]).toBe("$ bun add -g kcg-code@0.10.0");
    expect(log.lines).toContain("Resolving dependencies");
    expect(log.next).toBe(st.logOffset);
  });

  test("mode daemon -> restarting lalu restart dipanggil", async () => {
    let restarted = 0;
    const u = updater({
      spawn: fakeSpawn({ stdout: BUN_OUTPUT }).spawn,
      restart: () => restarted++,
    });
    await u.start("0.10.0");
    await u.settled();
    expect((await u.status()).phase).toBe("restarting");
    await Bun.sleep(5);
    expect(restarted).toBe(1);
  });

  test("bun gagal -> failed UPDATE_INSTALL_FAILED", async () => {
    const u = updater({ spawn: fakeSpawn({ stdout: "error: 404\n", code: 1 }).spawn });
    await u.start("0.10.0");
    await u.settled();
    expect(await u.status()).toMatchObject({ phase: "failed", error: "UPDATE_INSTALL_FAILED" });
    expect(u.logs(0).lines).toContain("error: 404");
  });

  test("versi di disk tidak berubah -> UPDATE_VERIFY_FAILED", async () => {
    const u = updater({
      spawn: fakeSpawn({ stdout: BUN_OUTPUT }).spawn,
      readInstalledVersion: async () => "0.9.0",
    });
    await u.start("0.10.0");
    await u.settled();
    expect(await u.status()).toMatchObject({ phase: "failed", error: "UPDATE_VERIFY_FAILED" });
  });

  test("timeout -> proses dibunuh, UPDATE_TIMEOUT", async () => {
    const fake = fakeSpawn({ hang: true });
    const u = updater({ spawn: fake.spawn, timeoutMs: 5 });
    await u.start("0.10.0");
    await u.settled();
    expect(fake.killed()).toBe(true);
    expect((await u.status()).error).toBe("UPDATE_TIMEOUT");
  });
});

describe("validasi start", () => {
  test("tidak didukung / versi lain / tidak ada update", async () => {
    expect(await updater({ unsupported: "NOT_BUN_GLOBAL" }).start("0.10.0")).toEqual({
      ok: false,
      error: "UPDATE_UNSUPPORTED",
    });
    expect(await updater().start("0.11.0")).toEqual({ ok: false, error: "UPDATE_NOT_AVAILABLE" });
    expect(await updater({ updates: checker(null) }).start("0.10.0")).toEqual({
      ok: false,
      error: "UPDATE_NOT_AVAILABLE",
    });
  });

  test("sedang berjalan -> UPDATE_IN_PROGRESS", async () => {
    const fake = fakeSpawn({ hang: true });
    const u = updater({ spawn: fake.spawn, timeoutMs: 50 });
    await u.start("0.10.0");
    expect(await u.start("0.10.0")).toEqual({ ok: false, error: "UPDATE_IN_PROGRESS" });
    await u.settled();
  });
});

test("versi baru sudah terpasang tapi belum dijalankan -> installed sejak awal", async () => {
  const u = updater({ readInstalledVersion: async () => "0.10.0" });
  expect(await u.status()).toMatchObject({ phase: "installed", target: "0.10.0", progress: 100 });

  const fresh = updater({ readInstalledVersion: async () => "0.9.0" });
  expect((await fresh.status()).phase).toBe("idle");
});

test("status membawa Session running", async () => {
  const u = updater({ runningSessions: () => [{ id: "s1", title: "Fix login" }] });
  expect((await u.status()).runningSessions).toEqual([{ id: "s1", title: "Fix login" }]);
});
