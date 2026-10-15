/**
 * Pesan SDK non-teks Claude Code (`messages.ts` / `usage.ts`): konten
 * sub-agent, biaya & token per turn, pemakaian konteks, dan compact.
 */
import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "../../types";
import { createClaudeClient } from "../client";
import { data, fakeQuery, SID, setup, state, tick } from "./harness";

describe("sub-agent & pemakaian Claude Code", () => {
  const subMsg = (content: unknown[], parent: string | null = "toolu_A") => ({
    type: "assistant",
    message: { id: `api_${Math.random()}`, content },
    parent_tool_use_id: parent,
    uuid: "u",
  });

  test("konten jalur sub-agent ditandai parentToolID; TodoWrite sub-agent tidak menimpa task list", async () => {
    const { client, calls, events } = setup();
    await client.session.prompt({ sessionID: SID, text: "cari" });
    await tick();
    const q = calls[0]?.query;
    q?.push(state("running"));
    q?.push(
      subMsg([
        { type: "text", text: "hasil" },
        { type: "tool_use", id: "toolu_B", name: "Grep", input: { pattern: "x" } },
        {
          type: "tool_use",
          id: "toolu_T",
          name: "TodoWrite",
          input: { todos: [{ content: "a" }] },
        },
      ]),
    );
    await tick();
    const text = events.find((e) => e.type === "session.text.ended");
    expect(data(text).parentToolID).toBe("toolu_A");
    const grep = events.find((e) => e.type === "session.tool.called" && data(e).id === "toolu_B");
    expect(data(grep).parentToolID).toBe("toolu_A");
    expect(events.some((e) => e.type === "agent.todos.updated")).toBe(false);
  });

  test("setelah idle, konten tanpa prompt membuka turn & pesan baru", async () => {
    const { client, calls, events } = setup();
    await client.session.prompt({ sessionID: SID, text: "a" });
    await tick();
    const q = calls[0]?.query;
    q?.push(state("running"));
    q?.push(state("idle"));
    // Agent dibangunkan hasil sub-agent latar belakang.
    q?.push(state("running"));
    q?.push(subMsg([{ type: "text", text: "jawaban akhir" }], null));
    q?.push(state("idle"));
    await tick();
    const starts = events.filter((e) => e.type === "session.execution.started");
    const steps = events
      .filter((e) => e.type === "session.step.started")
      .map((e) => data(e).assistantMessageID);
    expect(starts).toHaveLength(2);
    expect(new Set(steps).size).toBe(2);
    expect(data(events.findLast((e) => e.type === "session.text.ended")).assistantMessageID).toBe(
      steps[1],
    );
  });

  test("task_* sub-agent -> agent.subagent; task lain tidak; task latar menahan penutupan idle", async () => {
    const timers: (() => void)[] = [];
    const { fn, calls } = fakeQuery();
    const client = createClaudeClient("/proj", {
      query: fn,
      env: {},
      transcripts: { exists: async () => false, remove: async () => {} },
      setTimeoutFn: (cb) => timers.push(cb),
      clearTimeoutFn: () => {},
    });
    const events: AgentEvent[] = [];
    client.event.subscribe((e) => events.push(e));
    await client.session.prompt({ sessionID: SID, text: "a" });
    await tick();
    const q = calls[0]?.query;
    const sys = (subtype: string, extra: Record<string, unknown>) => ({
      type: "system",
      subtype,
      ...extra,
    });
    q?.push(state("running"));
    q?.push(
      sys("task_started", {
        task_id: "t1",
        tool_use_id: "toolu_A",
        description: "Find auth",
        subagent_type: "Explore",
        is_backgrounded: true,
        task_type: "local_agent",
      }),
    );
    q?.push(
      sys("task_started", {
        task_id: "t2",
        tool_use_id: "toolu_S",
        is_backgrounded: true,
        task_type: "local_bash",
      }),
    );
    q?.push(
      sys("task_progress", {
        task_id: "t1",
        usage: { total_tokens: 23_705, tool_uses: 1, duration_ms: 1878 },
        last_tool_name: "Bash",
      }),
    );
    q?.push(state("idle"));
    await tick();
    const subs = events
      .filter((e) => e.type === "agent.subagent")
      .map((e) => {
        const { sessionID: _s, assistantMessageID: _m, ...rest } = data(e);
        return rest;
      });
    expect(subs).toEqual([
      {
        toolID: "toolu_A",
        status: "running",
        agentType: "Explore",
        description: "Find auth",
        background: true,
      },
      { toolID: "toolu_A", tokens: 23_705, toolUses: 1, durationMs: 1878, lastTool: "Bash" },
    ]);
    // Idle: task latar masih jalan -> proses tidak ditutup.
    timers.shift()?.();
    expect(q?.closed).toBe(false);
    q?.push(
      sys("task_notification", {
        task_id: "t1",
        status: "completed",
        summary: "src/a.ts",
        usage: { total_tokens: 26_340, tool_uses: 2, duration_ms: 4000 },
      }),
    );
    q?.push(sys("task_notification", { task_id: "t2", status: "completed" }));
    await tick();
    expect(data(events.findLast((e) => e.type === "agent.subagent"))).toMatchObject({
      toolID: "toolu_A",
      status: "completed",
      summary: "src/a.ts",
      tokens: 26_340,
    });
    // Semua task selesai saat agent utama idle -> turn latar ditutup.
    expect(events.at(-1)?.type).toBe("session.execution.succeeded");
    timers.at(-1)?.();
    expect(q?.closed).toBe(true);
  });

  test("result -> step.ended dengan selisih biaya & token kumulatif per turn", async () => {
    const { client, calls, events } = setup();
    const result = (cost: number, input: number, output: number) => ({
      type: "result",
      subtype: "success",
      total_cost_usd: cost,
      modelUsage: {
        haiku: {
          inputTokens: input,
          outputTokens: output,
          cacheReadInputTokens: 100,
          cacheCreationInputTokens: 10,
        },
      },
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await client.session.prompt({ sessionID: SID, text: "a" });
    await tick();
    const q = calls[0]?.query;
    q?.push(state("running"));
    q?.push(result(0.0137, 8, 631));
    q?.push(state("idle"));
    await tick();
    await client.session.prompt({ sessionID: SID, text: "b" });
    q?.push(state("running"));
    q?.push(result(0.0143, 12, 647));
    q?.push(state("idle"));
    await tick();
    const usage = events.filter((e) => e.type === "session.step.ended").map((e) => data(e));
    expect(usage[0]).toMatchObject({
      cost: 0.0137,
      tokens: { input: 8, output: 631, reasoning: 0, cache: { read: 100, write: 10 } },
    });
    expect(usage[1]?.cost as number).toBeCloseTo(0.0006);
    expect(usage[1]?.tokens).toEqual({
      input: 4,
      output: 16,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    });
  });

  test("resume tanpa total dasar (server restart) -> token turn dari `usage`, tanpa biaya", async () => {
    const { client, calls, events } = setup([SID]);
    await client.session.get(SID);
    await client.session.prompt({ sessionID: SID, text: "a" });
    await tick();
    const q = calls[0]?.query;
    q?.push(state("running"));
    q?.push({
      type: "result",
      subtype: "success",
      total_cost_usd: 5.2,
      modelUsage: { m: { inputTokens: 900_000, outputTokens: 40_000 } },
      usage: { input_tokens: 4, output_tokens: 16, cache_read_input_tokens: 47_591 },
    });
    q?.push(state("idle"));
    await tick();
    const usage = data(events.find((e) => e.type === "session.step.ended"));
    expect(usage.cost).toBeUndefined();
    expect(usage.tokens).toEqual({
      input: 4,
      output: 16,
      reasoning: 0,
      cache: { read: 47_591, write: 0 },
    });
  });
});

describe("konteks & compact Claude Code", () => {
  test("pemakaian konteks: getContextUsage (summary) dipetakan & di-cache; saat idle diukur ulang", async () => {
    const { client, calls } = setup();
    expect(await client.session.contextUsage(SID)).toEqual({ ok: true, data: null });
    await client.session.prompt({ sessionID: SID, text: "a" });
    await tick();
    const q = calls[0]?.query;
    const res = await client.session.contextUsage(SID);
    expect(res.ok && res.data).toMatchObject({
      usedTokens: 50_000,
      maxTokens: 200_000,
      percent: 25,
      autoCompactAt: 167_000,
      model: "claude-sonnet",
      // Hanya kategori yang menempati window, terbesar dulu.
      categories: [
        { name: "Messages", tokens: 30_000 },
        { name: "System tools", tokens: 20_000 },
      ],
    });
    // Poll berikutnya memakai cache.
    await client.session.contextUsage(SID);
    expect(q?.usageCalls).toBe(1);
    // Akhir turn -> diukur ulang.
    q?.push(state("running"));
    q?.push(state("idle"));
    await tick();
    await tick();
    expect(q?.usageCalls).toBe(2);
  });

  test("/compact: status compacting -> started (manual); compact_boundary -> ended + token", async () => {
    const { client, calls, events } = setup();
    await client.session.prompt({ sessionID: SID, text: "/compact fokus ke API" });
    await tick();
    const q = calls[0]?.query;
    q?.push(state("running"));
    q?.push({ type: "system", subtype: "status", status: "compacting" });
    q?.push({ type: "system", subtype: "status", status: null, compact_result: "success" });
    q?.push({
      type: "system",
      subtype: "compact_boundary",
      compact_metadata: { trigger: "manual", pre_tokens: 33_333, post_tokens: 3_847 },
    });
    q?.push(state("idle"));
    await tick();
    const compaction = events.filter((e) => e.type === "agent.compaction").map((e) => e.data);
    const msgId = data(events.find((e) => e.type === "session.step.started"))
      .assistantMessageID as string;
    expect(compaction).toEqual([
      { sessionID: SID, phase: "started", trigger: "manual", assistantMessageID: msgId },
      {
        sessionID: SID,
        phase: "ended",
        trigger: "manual",
        assistantMessageID: msgId,
        preTokens: 33_333,
        postTokens: 3_847,
      },
    ]);
  });

  test("auto-compact gagal -> failed; compact terputus (interrupt) -> failed `aborted`", async () => {
    const { client, calls, events } = setup();
    await client.session.prompt({ sessionID: SID, text: "kerjakan" });
    await tick();
    const q = calls[0]?.query;
    q?.push(state("running"));
    q?.push({ type: "system", subtype: "status", status: "compacting" });
    q?.push({
      type: "system",
      subtype: "status",
      status: null,
      compact_result: "failed",
      compact_error: "Prompt too long",
    });
    q?.push({ type: "system", subtype: "status", status: "compacting" });
    await tick();
    await client.session.interrupt(SID);
    q?.push(state("idle"));
    await tick();
    const phases = events
      .filter((e) => e.type === "agent.compaction")
      .map((e) => {
        const d = e.data as { phase: string; trigger: string; error?: { type: string } };
        return [d.phase, d.trigger, d.error?.type ?? null];
      });
    expect(phases).toEqual([
      ["started", "auto", null],
      ["failed", "auto", "compaction.failed"],
      ["started", "auto", null],
      ["failed", "auto", "aborted"],
    ]);
  });
});
