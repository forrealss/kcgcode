/**
 * Unit test daftar per agent (src/lib/agent-lists.ts).
 */
import { describe, expect, test } from "bun:test";
import { ApiError } from "@/lib/api";
import {
  type AgentLists,
  collectAgentLists,
  describeFailedAgents,
  replaceAgentList,
} from "../agent-lists";

describe("collectAgentLists", () => {
  test("hasil urut AGENT_TYPES: opencode lalu claude-code", () => {
    const out = collectAgentLists(
      [
        { status: "fulfilled", value: ["a"] },
        { status: "fulfilled", value: ["b", "c"] },
      ],
      "Failed to load",
    );
    expect(out).toEqual({ byAgent: { opencode: ["a"], "claude-code": ["b", "c"] }, failed: [] });
  });

  test("agent gagal: pesan ApiError dipakai, error lain memakai fallback", () => {
    const out = collectAgentLists<string>(
      [
        { status: "rejected", reason: new ApiError(500, "X", "Server said no") },
        { status: "rejected", reason: new TypeError("network") },
      ],
      "Failed to load skills",
    );
    expect(out.byAgent).toEqual({});
    expect(out.failed).toEqual([
      { agent: "opencode", message: "Server said no" },
      { agent: "claude-code", message: "Failed to load skills" },
    ]);
  });

  test("sebagian gagal: daftar agent lain tetap ada", () => {
    const out = collectAgentLists(
      [
        { status: "fulfilled", value: [1] },
        { status: "rejected", reason: new ApiError(404, "Y", "Not found") },
      ],
      "Failed to load",
    );
    expect(out.byAgent).toEqual({ opencode: [1] });
    expect(out.failed).toEqual([{ agent: "claude-code", message: "Not found" }]);
  });
});

describe("replaceAgentList", () => {
  const lists: AgentLists<string> = {
    byAgent: { opencode: ["a"] },
    failed: [{ agent: "claude-code", message: "down" }],
  };

  test("ganti daftar satu agent & hapus status gagalnya", () => {
    expect(replaceAgentList(lists, "claude-code", ["x"])).toEqual({
      byAgent: { opencode: ["a"], "claude-code": ["x"] },
      failed: [],
    });
  });

  test("agent lain tidak berubah; input tidak dimutasi", () => {
    const out = replaceAgentList(lists, "opencode", []);
    expect(out).toEqual({ byAgent: { opencode: [] }, failed: lists.failed });
    expect(lists.byAgent).toEqual({ opencode: ["a"] });
  });
});

describe("describeFailedAgents", () => {
  test("label agent digabung koma", () => {
    expect(describeFailedAgents([{ agent: "claude-code", message: "x" }])).toBe(
      "Couldn't read Claude Code",
    );
    expect(
      describeFailedAgents([
        { agent: "opencode", message: "x" },
        { agent: "claude-code", message: "y" },
      ]),
    ).toBe("Couldn't read OpenCode, Claude Code");
  });
});
