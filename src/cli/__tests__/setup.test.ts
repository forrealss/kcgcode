import { describe, expect, test } from "bun:test";
import { renderSetup, type SetupState, setupButtons, tildify } from "../setup";
import { stripAnsi } from "../theme";

const missing: SetupState = { kind: "missing", configPath: "/home/me/.kcgcode/config.json" };

describe("setupButtons", () => {
  test("config hilang → tombol init + quit", () => {
    expect(setupButtons(missing).map((b) => b.id)).toEqual(["init", "quit"]);
  });

  test("setelah init → start + quit", () => {
    const ready: SetupState = {
      kind: "ready",
      configPath: "/c.json",
      sandboxPath: "/sandbox",
      dataDir: "/data",
    };
    expect(setupButtons(ready).map((b) => b.id)).toEqual(["start", "quit"]);
  });

  test("config rusak → hanya quit (init tidak menimpa config)", () => {
    const invalid: SetupState = { kind: "invalid", configPath: "/c.json", error: "bad" };
    expect(setupButtons(invalid).map((b) => b.id)).toEqual(["quit"]);
  });
});

describe("tildify", () => {
  test("ganti home dengan ~", () => {
    expect(tildify("/home/me/.kcgcode/config.json", "/home/me")).toBe("~/.kcgcode/config.json");
    expect(tildify("/home/meow/x", "/home/me")).toBe("/home/meow/x");
  });
});

describe("renderSetup", () => {
  test("pesan belum init + tombol init", () => {
    const frame = stripAnsi(renderSetup(missing, "0.2.2"));
    expect(frame).toContain("Not set up yet");
    expect(frame).toContain("config.json");
    expect(frame).toContain("Run kcgcode init");
    expect(frame).toContain("Quit");
  });

  test("error config tanpa prefix [config]", () => {
    const frame = stripAnsi(
      renderSetup(
        { kind: "invalid", configPath: "/c.json", error: "[config] invalid JSON" },
        "0.2.2",
      ),
    );
    expect(frame).toContain("invalid JSON");
    expect(frame).not.toContain("[config]");
  });

  test("ditengahkan horizontal & vertikal", () => {
    const columns = 100;
    const rows = 50;
    const lines = stripAnsi(renderSetup(missing, "0.2.2", { columns, rows })).split("\n");
    expect(lines.length).toBe(rows);

    const filled = lines.map((l, i) => [l, i] as const).filter(([l]) => l.trim() !== "");
    const top = filled[0]?.[1] ?? 0;
    const bottom = rows - 1 - (filled.at(-1)?.[1] ?? 0);
    expect(Math.abs(top - bottom)).toBeLessThanOrEqual(1);

    const left = Math.min(...filled.map(([l]) => l.length - l.trimStart().length));
    const right = Math.min(...filled.map(([l]) => columns - l.trimEnd().length));
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
  });
});
