/**
 * Unit test helper sub-agent & pemakaian turn (src/lib/subagents.ts).
 */
import { describe, expect, test } from "bun:test";
import type { MessagePart, SessionMessage } from "@/types";
import { formatCost, indexSubagents, isSubagentTool, subagentView, turnUsage } from "../subagents";
import { turnBlocks, turnSegments, turnStatus } from "../turns";

const msg = (id: string, parts: MessagePart[]): SessionMessage => ({
  id,
  sessionId: "s",
  role: "assistant",
  parts,
  createdAt: 1,
});

const task: MessagePart = {
  id: "prt_toolu_A",
  type: "tool",
  tool: "task",
  callID: "toolu_A",
  state: {
    status: "completed",
    input: { subagent_type: "Explore", description: "Find auth", prompt: "Look for…" },
    output: "Async agent launched successfully. agentId: x",
    time: { start: 1_000, end: 1_200 },
  },
};

describe("indeks & tampilan sub-agent", () => {
  const messages = [
    msg("m1", [
      { id: "t0", type: "text", text: "Saya cek dulu." },
      task,
      { id: "r1", type: "reasoning", text: "", parentToolID: "toolu_A" },
      {
        id: "g1",
        type: "tool",
        tool: "grep",
        parentToolID: "toolu_A",
        state: { status: "completed" },
      },
      {
        id: "s1",
        type: "subagent",
        toolID: "toolu_A",
        status: "running",
        background: true,
        tokens: 23_705,
      },
    ]),
    // Sub-agent latar belakang selesai di turn berikutnya — info terbaru berlaku.
    msg("m2", [
      { id: "x1", type: "text", text: "src/a.ts", parentToolID: "toolu_A" },
      {
        id: "s2",
        type: "subagent",
        toolID: "toolu_A",
        status: "completed",
        background: true,
        tokens: 26_340,
        toolUses: 2,
        durationMs: 4_000,
        summary: "Auth ada di src/a.ts",
      },
      { id: "u", type: "usage", tokens: { input: 1, output: 1 } },
    ]),
  ];

  test("konten & info dikelompokkan per tool call lintas pesan", () => {
    const index = indexSubagents(messages);
    const entry = index.get("toolu_A");
    expect(entry?.info?.id).toBe("s2");
    expect(entry?.parts.map((p) => p.id)).toEqual(["r1", "g1", "x1"]);
  });

  test("view: status & statistik dari info; output peluncuran latar tidak jadi hasil", () => {
    const view = subagentView(task, indexSubagents(messages).get("toolu_A"));
    expect(view).toMatchObject({
      toolID: "toolu_A",
      agentType: "Explore",
      description: "Find auth",
      prompt: "Look for…",
      status: "completed",
      tokens: 26_340,
      toolUses: 2,
      durationMs: 4_000,
      lastTool: "grep",
      result: "Auth ada di src/a.ts",
    });
  });

  test("tanpa info (opencode): status & durasi dari tool, hasil = output tool", () => {
    const oc: MessagePart = {
      ...task,
      state: { ...(task.state as object), output: "Ringkasan sub-agent" },
    };
    const view = subagentView(oc, { info: null, parts: [] });
    expect(view.status).toBe("completed");
    expect(view.durationMs).toBe(200);
    expect(view.toolUses).toBe(0);
    expect(view.result).toBe("Ringkasan sub-agent");
    expect(subagentView({ ...task, state: { status: "error" } }, undefined).status).toBe("failed");
  });

  test("timeline: konten sub-agent & metadata disembunyikan; tool task jadi blok sub-agent", () => {
    const segments = turnSegments(messages);
    expect(segments.map((s) => s.kind)).toEqual(["text", "subagent"]);
    expect(turnBlocks(segments).map((b) => b.content?.kind)).toEqual(["text", "subagent"]);
    expect(isSubagentTool(task)).toBe(true);
    expect(turnStatus([msg("m", [task])], true)).toBe("Sub-agent: Find auth");
  });
});

describe("pemakaian turn", () => {
  test("jumlah part usage (reasoning masuk output); tanpa pemakaian -> null", () => {
    const usage = turnUsage([
      msg("a", [
        {
          id: "u1",
          type: "usage",
          cost: 0.0137,
          tokens: { input: 8, output: 600, reasoning: 31, cache: { read: 56_797, write: 73_914 } },
        },
      ]),
      msg("b", [
        { id: "u2", type: "usage", tokens: { input: 2, output: 10, cache: { read: 0, write: 0 } } },
      ]),
    ]);
    expect(usage).toEqual({
      total: 131_362,
      input: 10,
      output: 641,
      cacheRead: 56_797,
      cacheWrite: 73_914,
      cost: 0.0137,
    });
    expect(turnUsage([msg("c", [{ id: "u", type: "usage", tokens: {} }])])).toBeNull();
    expect(turnUsage([msg("d", [{ id: "t", type: "text", text: "x" }])])).toBeNull();
  });

  test("formatCost", () => {
    expect(formatCost(0.0006)).toBe("<$0.01");
    expect(formatCost(0.0137)).toBe("$0.014");
    expect(formatCost(0.25)).toBe("$0.25");
    expect(formatCost(1.234)).toBe("$1.23");
  });
});
