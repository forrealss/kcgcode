import { describe, expect, test } from "bun:test";
import { parseArgs } from "../args";
import { disabledKeepAwake, inhibitCommand, startKeepAwake } from "../keep-awake";

describe("inhibitCommand", () => {
  test("linux: systemd-inhibit memblok sleep & idle, child cat terikat stdin", () => {
    const cmd = inhibitCommand("linux", 123);
    expect(cmd?.[0]).toBe("systemd-inhibit");
    expect(cmd).toContain("--what=sleep:idle");
    expect(cmd).toContain("--mode=block");
    expect(cmd?.at(-1)).toBe("cat");
  });

  test("darwin: caffeinate menunggu pid kcgcode", () => {
    expect(inhibitCommand("darwin", 123)).toEqual(["caffeinate", "-i", "-s", "-w", "123"]);
  });

  test("platform lain tidak didukung", () => {
    expect(inhibitCommand("freebsd", 123)).toBeNull();
  });
});

describe("startKeepAwake", () => {
  test("platform tak didukung → nonaktif dengan alasan", async () => {
    const ka = await startKeepAwake("aix");
    expect(ka.status()).toEqual({ active: false, method: null, error: "unsupported on aix" });
    ka.stop();
  });

  test("disabledKeepAwake melaporkan --allow-sleep", () => {
    expect(disabledKeepAwake().status().active).toBe(false);
    expect(disabledKeepAwake().status().error).toContain("--allow-sleep");
  });
});

describe("parseArgs --allow-sleep", () => {
  test("default keep awake", () => {
    expect(parseArgs([]).allowSleep).toBeUndefined();
  });

  test("flag mengizinkan sleep", () => {
    expect(parseArgs(["start", "--allow-sleep"]).allowSleep).toBe(true);
  });
});
