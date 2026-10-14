/**
 * Unit test daftar MCP Claude Code (src/server/services/claude-mcp.ts).
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claudeJsonPath,
  mergeClaudeMcp,
  parseClaudeMcpConfig,
  readClaudeMcpConfig,
} from "../claude-mcp";

describe("parseClaudeMcpConfig", () => {
  test("gabung local > project > user; .mcp.json yang ditolak -> disabled", () => {
    const entries = parseClaudeMcpConfig(
      "/p/",
      { mcpServers: { shared: {}, proj: {}, rejected: {} } },
      {
        mcpServers: { shared: {}, mine: {} },
        projects: {
          "/p": { mcpServers: { shared: {} }, disabledMcpjsonServers: ["rejected"] },
          "/other": { mcpServers: { elsewhere: {} } },
        },
      },
    );
    expect(entries).toEqual([
      { name: "mine", scope: "user", disabled: false },
      { name: "proj", scope: "project", disabled: false },
      { name: "rejected", scope: "project", disabled: true },
      { name: "shared", scope: "local", disabled: false },
    ]);
  });

  test("input tak valid -> kosong", () => {
    expect(parseClaudeMcpConfig("/p", null, "x")).toEqual([]);
    expect(parseClaudeMcpConfig("/p", { mcpServers: [] }, { mcpServers: 1 })).toEqual([]);
  });
});

describe("mergeClaudeMcp", () => {
  test("status live menang; server live tanpa config tetap ikut", () => {
    const merged = mergeClaudeMcp(
      [
        { name: "a", scope: "user", disabled: false },
        { name: "b", scope: "project", disabled: true },
        { name: "c", scope: "local", disabled: false },
      ],
      [
        { name: "a", status: "failed", error: "boom" },
        { name: "plugin:x", status: "connected", error: null },
      ],
    );
    expect(merged).toEqual([
      { name: "a", status: "failed", error: "boom" },
      { name: "b", status: "disabled", error: null },
      { name: "c", status: "unknown", error: null },
      { name: "plugin:x", status: "connected", error: null },
    ]);
  });
});

describe("readClaudeMcpConfig", () => {
  test("membaca .mcp.json Project + .claude.json di CLAUDE_CONFIG_DIR", async () => {
    const root = mkdtempSync(join(tmpdir(), "kcg-cc-mcp-"));
    const project = join(root, "proj");
    const config = join(root, "cfg");
    mkdirSync(project);
    mkdirSync(config);
    writeFileSync(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { db: {} } }));
    writeFileSync(join(config, ".claude.json"), JSON.stringify({ mcpServers: { web: {} } }));
    const entries = await readClaudeMcpConfig(project, { CLAUDE_CONFIG_DIR: config });
    expect(entries.map((e) => [e.name, e.scope])).toEqual([
      ["db", "project"],
      ["web", "user"],
    ]);
  });

  test("file tidak ada / rusak -> kosong", async () => {
    const root = mkdtempSync(join(tmpdir(), "kcg-cc-mcp-"));
    writeFileSync(join(root, ".mcp.json"), "{not json");
    expect(await readClaudeMcpConfig(root, { HOME: join(root, "nohome") })).toEqual([]);
  });

  test("claudeJsonPath: CLAUDE_CONFIG_DIR, lalu HOME", () => {
    expect(claudeJsonPath({ CLAUDE_CONFIG_DIR: "/cfg" })).toBe(join("/cfg", ".claude.json"));
    expect(claudeJsonPath({ HOME: "/home/u" })).toBe(join("/home/u", ".claude.json"));
  });
});
