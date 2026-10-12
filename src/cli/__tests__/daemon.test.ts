import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "../args";
import { childArgv, daemonStatePath, isAlive, runningDaemon, writeDaemonState } from "../daemon";

describe("parseArgs daemon", () => {
  test("start -d + command stop/status/logs", () => {
    expect(parseArgs(["start", "-d"]).detach).toBe(true);
    expect(parseArgs(["--detach", "-p", "4000"])).toMatchObject({
      command: "start",
      detach: true,
      port: 4000,
    });
    expect(parseArgs(["stop"]).command).toBe("stop");
    expect(parseArgs(["status"]).command).toBe("status");
    expect(parseArgs(["logs", "-f", "-n", "20"])).toMatchObject({
      command: "logs",
      follow: true,
      lines: 20,
    });
    expect(parseArgs(["logs", "-n", "abc"]).command).toBe("invalid");
  });

  test("childArgv meneruskan opsi server, tanpa -d / --open", () => {
    const args = parseArgs([
      "start",
      "-d",
      "--open",
      "-p",
      "4000",
      "-H",
      "0.0.0.0",
      "--allow-sleep",
    ]);
    expect(childArgv(args)).toEqual([
      "start",
      "--port",
      "4000",
      "--host",
      "0.0.0.0",
      "--allow-sleep",
    ]);
  });
});

describe("daemon state", () => {
  let dir: string;
  const prevDb = process.env.KCG_DB_PATH;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "kcg-daemon-"));
    process.env.KCG_DB_PATH = path.join(dir, "kcg.sqlite");
  });
  afterEach(() => {
    if (prevDb === undefined) delete process.env.KCG_DB_PATH;
    else process.env.KCG_DB_PATH = prevDb;
    rmSync(dir, { recursive: true, force: true });
  });

  const state = (pid: number) => ({
    pid,
    port: 3000,
    hostname: "127.0.0.1",
    localUrl: "http://127.0.0.1:3000",
    publicUrl: null,
    startedAt: Date.now(),
    logFile: path.join(dir, "kcgcode.log"),
  });

  test("state dengan pid hidup dikembalikan", async () => {
    await writeDaemonState(state(process.pid));
    expect(isAlive(process.pid)).toBe(true);
    expect((await runningDaemon())?.pid).toBe(process.pid);
  });

  test("state basi (pid mati) dibersihkan", async () => {
    const dead = Bun.spawnSync(["true"]).pid;
    await writeDaemonState(state(dead));
    expect(await runningDaemon()).toBeNull();
    expect(existsSync(daemonStatePath())).toBe(false);
  });
});
