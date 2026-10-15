/**
 * `createHostSessions`: membaca jejak proses Claude Code interaktif
 * (`<config>/sessions/<pid>.json`) dan metadata Session Claude Desktop dari
 * direktori sementara.
 */
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHostSessions, desktopDataDir } from "../host-sessions";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function tmp(): string {
  const root = mkdtempSync(path.join(tmpdir(), "kcg-host-"));
  roots.push(root);
  return root;
}

function write(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
}

test("running: hanya proses interaktif yang masih hidup", async () => {
  const config = tmp();
  const dir = path.join(config, "sessions");
  write(path.join(dir, "100.json"), {
    pid: 100,
    sessionId: "desk",
    cwd: "/proj",
    entrypoint: "claude-desktop",
    name: "Fix bug",
  });
  write(path.join(dir, "200.json"), { pid: 200, sessionId: "dead", entrypoint: "cli" });
  // Proses SDK (termasuk milik KCG sendiri) bukan "tempat lain".
  write(path.join(dir, "300.json"), { pid: 300, sessionId: "kcg", entrypoint: "sdk-ts" });
  write(path.join(dir, "400.json"), "{not json");
  write(path.join(dir, "400.abc.key"), "x");
  const host = createHostSessions({ CLAUDE_CONFIG_DIR: config }, (pid) => pid !== 200);
  const running = await host.running();
  expect([...running.entries()]).toEqual([
    ["desk", { pid: 100, entrypoint: "claude-desktop", cwd: "/proj", name: "Fix bug" }],
  ]);
});

test("desktop: judul dari local_*.json semua org/akun; direktori kosong aman", async () => {
  const home = tmp();
  const env = { HOME: home, XDG_CONFIG_HOME: path.join(home, "cfg") };
  const root = path.join(desktopDataDir(env, "linux"), "claude-code-sessions");
  write(path.join(root, "org1", "acct1", "local_a.json"), {
    cliSessionId: "s1",
    title: "Migrate yt-dlp",
  });
  write(path.join(root, "org1", "acct1", "local_b.json"), { title: "no cli id" });
  write(path.join(root, "org2", "acct2", "local_c.json"), { cliSessionId: "s2" });
  const meta = await createHostSessions(env).desktop();
  expect([...meta.entries()].sort()).toEqual([
    ["s1", { title: "Migrate yt-dlp" }],
    ["s2", { title: undefined }],
  ]);
  expect((await createHostSessions({ HOME: tmp() }).desktop()).size).toBe(0);
});

test("desktopDataDir per platform", () => {
  const env = { HOME: "/h", APPDATA: "C:\\Users\\u\\AppData\\Roaming" };
  expect(desktopDataDir(env, "darwin")).toBe("/h/Library/Application Support/Claude");
  expect(desktopDataDir(env, "linux")).toBe("/h/.config/Claude");
  expect(desktopDataDir(env, "win32")).toBe(path.join(env.APPDATA, "Claude"));
});
