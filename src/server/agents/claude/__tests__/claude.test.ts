/**
 * Adapter Claude Code: penerjemah pesan SDK -> `AgentEvent` (bentuk opencode
 * v2), dan client in-process (spawn malas, permission/form lewat
 * `canUseTool`, interrupt, resume) dengan `query()` palsu.
 */
import { describe, expect, test } from "bun:test";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Options, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { AGENT_REQUEST_GONE, type AgentEvent } from "../../types";
import { CLAUDE_PROVIDER_ID, type ClaudeQueryLike, createClaudeClient } from "../client";
import {
  ClaudeTurnTranslator,
  normalizeToolInput,
  permissionName,
  todosFromInput,
  toolName,
} from "../translate";

const SID = "11111111-1111-4111-8111-111111111111";

function translator() {
  const events: AgentEvent[] = [];
  const t = new ClaudeTurnTranslator(SID, (ev) => events.push(ev));
  return { t, events };
}

/** `data` event (union) sebagai record untuk asersi. */
const data = (ev: AgentEvent | undefined) => (ev?.data ?? {}) as Record<string, unknown>;

const streamEvent = (event: Record<string, unknown>, parent: string | null = null) => ({
  type: "stream_event",
  event,
  parent_tool_use_id: parent,
  uuid: "u",
  session_id: SID,
});

describe("translate helpers", () => {
  test("nama tool & permission dinormalisasi", () => {
    expect(toolName("Read")).toBe("read");
    expect(toolName("MultiEdit")).toBe("edit");
    expect(toolName("mcp__github__search")).toBe("mcp__github__search");
    expect(toolName("SomethingNew")).toBe("somethingnew");
    expect(permissionName("Write")).toBe("edit");
    expect(permissionName("Bash")).toBe("bash");
  });

  test("file_path diberi alias filePath (renderer & Reference)", () => {
    expect(normalizeToolInput({ file_path: "/p/a.ts" })).toEqual({
      file_path: "/p/a.ts",
      filePath: "/p/a.ts",
    });
    expect(normalizeToolInput(null)).toEqual({});
  });

  test("TodoWrite -> task list dengan prioritas default", () => {
    expect(
      todosFromInput({
        todos: [{ content: "a", status: "in_progress", activeForm: "A" }, { x: 1 }],
      }),
    ).toEqual([{ content: "a", status: "in_progress", priority: "medium" }]);
    expect(todosFromInput({})).toBeNull();
  });
});

describe("ClaudeTurnTranslator", () => {
  test("beginTurn -> execution.started + step.started dengan pesan lokal", () => {
    const { t, events } = translator();
    t.beginTurn();
    expect(events.map((e) => e.type)).toEqual([
      "session.execution.started",
      "session.step.started",
    ]);
    expect(data(events[1]).assistantMessageID).toBe(t.currentMessageId);
  });

  test("stream text -> started/delta/ended; blok yang sama di pesan assistant dilewati", () => {
    const { t, events } = translator();
    t.beginTurn();
    const msg = t.currentMessageId;
    t.handle(streamEvent({ type: "message_start", message: { id: "api_1" } }));
    t.handle(
      streamEvent({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      }),
    );
    t.handle(
      streamEvent({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hi" },
      }),
    );
    t.handle({
      type: "assistant",
      message: { id: "api_1", content: [{ type: "text", text: "Hi" }] },
      parent_tool_use_id: null,
      uuid: "a1",
    });
    t.handle(streamEvent({ type: "content_block_stop", index: 0 }));

    expect(events.slice(2).map((e) => e.type)).toEqual([
      "session.text.started",
      "session.text.delta",
      "session.text.ended",
    ]);
    expect(data(events[3])).toEqual({
      sessionID: SID,
      assistantMessageID: msg,
      ordinal: 0,
      delta: "Hi",
    });
    expect(data(events[4])).toMatchObject({ ordinal: 0, text: "Hi" });
  });

  test("thinking -> session.reasoning.*", () => {
    const { t, events } = translator();
    t.beginTurn();
    t.handle(streamEvent({ type: "message_start", message: { id: "api_2" } }));
    t.handle(
      streamEvent({ type: "content_block_start", index: 0, content_block: { type: "thinking" } }),
    );
    t.handle(
      streamEvent({
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "hmm" },
      }),
    );
    t.handle(streamEvent({ type: "content_block_stop", index: 0 }));
    expect(events.at(-1)).toMatchObject({ type: "session.reasoning.ended", data: { text: "hmm" } });
  });

  test("thinking tanpa token (disembunyikan provider) tidak menghasilkan event teks", () => {
    const { t, events } = translator();
    t.beginTurn();
    t.handle(streamEvent({ type: "message_start", message: { id: "api_h" } }));
    t.handle(
      streamEvent({ type: "content_block_start", index: 0, content_block: { type: "thinking" } }),
    );
    t.handle(streamEvent({ type: "content_block_stop", index: 0 }));
    expect(events.map((e) => e.type)).toEqual([
      "session.execution.started",
      "session.step.started",
    ]);
  });

  test("ordinal per jenis blok bertambah dalam satu turn", () => {
    const { t, events } = translator();
    t.beginTurn();
    t.handle({
      type: "assistant",
      message: {
        id: "api_x",
        content: [
          { type: "text", text: "satu" },
          { type: "text", text: "dua" },
        ],
      },
      parent_tool_use_id: null,
      uuid: "a9",
    });
    const ended = events.filter((e) => e.type === "session.text.ended").map(data);
    expect(ended.map((d) => [d.ordinal, d.text])).toEqual([
      [0, "satu"],
      [1, "dua"],
    ]);
  });

  test("tool_use -> input.started + called; tool_result -> success/failed; TodoWrite -> todos", () => {
    const { t, events } = translator();
    t.beginTurn();
    const effects = t.handle({
      type: "assistant",
      message: {
        id: "api_3",
        content: [
          { type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "/p/a.ts" } },
          {
            type: "tool_use",
            id: "toolu_2",
            name: "TodoWrite",
            input: { todos: [{ content: "x", status: "pending" }] },
          },
        ],
      },
      parent_tool_use_id: null,
      uuid: "a2",
    });
    expect(effects.todos).toEqual([{ content: "x", status: "pending", priority: "medium" }]);
    expect(events[2]).toMatchObject({
      type: "session.tool.input.started",
      data: { id: "toolu_1", name: "read" },
    });
    expect(events[3]).toMatchObject({
      type: "session.tool.called",
      data: { id: "toolu_1", name: "read", input: { filePath: "/p/a.ts" } },
    });

    t.handle({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "file body" }],
      },
      parent_tool_use_id: null,
    });
    expect(events.at(-1)).toMatchObject({
      type: "session.tool.success",
      data: { id: "toolu_1", content: [{ type: "text", text: "file body" }] },
    });

    t.handle({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_2", content: "no", is_error: true }],
      },
      parent_tool_use_id: null,
    });
    expect(events.at(-1)).toMatchObject({
      type: "session.tool.failed",
      data: { id: "toolu_2", error: { message: "no" } },
    });
  });

  test("api_retry -> session.retry.scheduled", () => {
    const { t, events } = translator();
    t.handle({
      type: "system",
      subtype: "api_retry",
      attempt: 2,
      error: "rate_limit",
      error_status: 429,
    });
    expect(events[0]).toEqual({
      type: "session.retry.scheduled",
      data: {
        sessionID: SID,
        attempt: 2,
        error: { type: "provider.retry", message: "rate limit (HTTP 429)" },
      },
    });
  });
});

/** `query()` palsu: mencatat input & opsi, pesan SDK didorong dari test. */
function fakeQuery() {
  const calls: { options: Options; inputs: SDKUserMessage[]; query: FakeQ }[] = [];
  type FakeQ = ClaudeQueryLike & {
    push(m: Record<string, unknown>): void;
    end(): void;
    interrupted: number;
    models: string[];
    modes: string[];
    closed: boolean;
  };
  const fn = (params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => {
    const inputs: SDKUserMessage[] = [];
    void (async () => {
      for await (const m of params.prompt) inputs.push(m);
    })();
    const queue: SDKMessage[] = [];
    let wake: (() => void) | null = null;
    let done = false;
    const q: FakeQ = {
      interrupted: 0,
      models: [],
      modes: [],
      closed: false,
      push(m) {
        queue.push(m as unknown as SDKMessage);
        wake?.();
      },
      end() {
        done = true;
        wake?.();
      },
      async interrupt() {
        q.interrupted += 1;
      },
      async setModel(model) {
        q.models.push(model ?? "");
      },
      async setPermissionMode(mode) {
        q.modes.push(mode);
      },
      async supportedModels() {
        return [{ value: "sonnet", displayName: "Sonnet", description: "" }];
      },
      async mcpServerStatus() {
        return [{ name: "fs", status: "connected" }];
      },
      close() {
        q.closed = true;
        q.end();
      },
      async *[Symbol.asyncIterator]() {
        for (;;) {
          const next = queue.shift();
          if (next) {
            yield next;
            continue;
          }
          if (done) return;
          await new Promise<void>((r) => {
            wake = r;
          });
          wake = null;
        }
      },
    };
    calls.push({ options: params.options, inputs, query: q });
    return q;
  };
  return { fn, calls };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(existing: string[] = []) {
  const { fn, calls } = fakeQuery();
  const removed: string[] = [];
  const client = createClaudeClient("/proj", {
    query: fn,
    deleteSettleMs: 0,
    env: { HOME: "/home/u" },
    transcripts: {
      async exists(id) {
        return existing.includes(id);
      },
      async remove(id) {
        removed.push(id);
        existing.splice(existing.indexOf(id), 1);
      },
    },
  });
  const events: AgentEvent[] = [];
  client.event.subscribe((ev) => events.push(ev));
  return { client, calls, events, removed };
}

const state = (s: string) => ({ type: "system", subtype: "session_state_changed", state: s });

describe("createClaudeClient", () => {
  test("prompt pertama spawn proses dengan settings user & sessionId baru", async () => {
    const { client, calls, events } = setup();
    const created = await client.session.create();
    if (!created.ok) throw new Error("create");
    expect(calls.length).toBe(0); // malas: belum ada proses

    await client.session.switchModel(created.data.id, {
      providerID: CLAUDE_PROVIDER_ID,
      modelID: "sonnet",
    });
    const res = await client.session.prompt({ sessionID: created.data.id, text: "hello" });
    expect(res.ok).toBe(true);
    await tick();
    expect(calls.length).toBe(1);
    const opts = calls[0]?.options as Options;
    expect(opts.cwd).toBe("/proj");
    expect(opts.settingSources).toEqual(["user", "project", "local"]);
    expect(opts.sessionId).toBe(created.data.id);
    expect(opts.resume).toBeUndefined();
    expect(opts.model).toBe("sonnet");
    expect(opts.permissionMode).toBeUndefined(); // ikut defaultMode user
    expect(opts.env?.CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS).toBe("1");
    expect(opts.env?.HOME).toBe("/home/u");
    expect(calls[0]?.inputs[0]?.message).toEqual({ role: "user", content: "hello" });
    expect(events[0]).toEqual({
      type: "session.execution.started",
      data: { sessionID: created.data.id },
    });
  });

  test("transcript sudah ada -> resume; model/mode diganti lewat kontrol", async () => {
    const { client, calls } = setup([SID]);
    expect((await client.session.get(SID)).ok).toBe(true);
    await client.session.setPermissionMode(SID, "plan");
    await client.session.prompt({ sessionID: SID, text: "a" });
    await tick();
    expect(calls[0]?.options.resume).toBe(SID);
    expect(calls[0]?.options.sessionId).toBeUndefined();
    expect(calls[0]?.options.permissionMode).toBe("plan");

    await client.session.switchModel(SID, { providerID: CLAUDE_PROVIDER_ID, modelID: "opus" });
    await client.session.setPermissionMode(SID, null);
    await client.session.prompt({ sessionID: SID, text: "b" });
    await tick();
    expect(calls.length).toBe(1); // proses dipakai ulang
    expect(calls[0]?.query.models).toEqual(["opus"]);
    expect(calls[0]?.query.modes).toEqual(["default"]);
    expect(calls[0]?.inputs.length).toBe(2);
  });

  test("instruksi Project berubah -> proses diganti dengan systemPrompt append", async () => {
    const { client, calls } = setup();
    await client.session.prompt({ sessionID: SID, text: "a" });
    await tick();
    expect(calls[0]?.options.systemPrompt).toBeUndefined();
    await client.session.instructions(SID, "Selalu jawab singkat.");
    await client.session.prompt({ sessionID: SID, text: "b" });
    await tick();
    expect(calls.length).toBe(2);
    expect(calls[0]?.query.closed).toBe(true);
    expect(calls[1]?.options.systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
      append: "Selalu jawab singkat.",
    });
  });

  test("idle -> execution.succeeded; result error -> execution.failed saat idle", async () => {
    const { client, calls, events } = setup();
    await client.session.prompt({ sessionID: SID, text: "x" });
    await tick();
    const q = calls[0]?.query;
    q?.push(state("running"));
    q?.push({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      errors: ["boom"],
    });
    q?.push(state("idle"));
    await tick();
    expect(events.at(-1)).toEqual({
      type: "session.execution.failed",
      data: { sessionID: SID, error: { type: "error_during_execution", message: "boom" } },
    });

    await client.session.prompt({ sessionID: SID, text: "y" });
    q?.push(state("running"));
    q?.push(state("idle"));
    await tick();
    expect(events.at(-1)).toEqual({
      type: "session.execution.succeeded",
      data: { sessionID: SID },
    });
  });

  test("permission: canUseTool -> permission.asked; reply once/always/reject", async () => {
    const { client, calls, events } = setup();
    await client.session.prompt({ sessionID: SID, text: "x" });
    await tick();
    const canUseTool = calls[0]?.options.canUseTool;
    if (!canUseTool) throw new Error("canUseTool");
    const signal = new AbortController().signal;
    const rule = {
      type: "addRules" as const,
      rules: [{ toolName: "Bash", ruleContent: "git *" }],
      behavior: "allow" as const,
    };
    const suggestions = [{ ...rule, destination: "localSettings" as const }];

    const p1 = canUseTool(
      "Bash",
      { command: "git status" },
      { signal, suggestions, toolUseID: "t1", requestId: "r1" },
    );
    const asked = events.find((e) => e.type === "permission.asked");
    expect(data(asked)).toMatchObject({
      sessionID: SID,
      action: "bash",
      resources: ["git status"],
    });
    const id = String(data(asked).id);
    const reply = (decision: "once" | "always" | "reject") =>
      client.permission.reply({ sessionID: SID, requestID: id, decision });
    expect((await reply("always")).ok).toBe(true);
    expect(await p1).toEqual({
      behavior: "allow",
      updatedInput: { command: "git status" },
      // "Always" berlaku per Session, tidak menulis file settings.
      updatedPermissions: [{ ...rule, destination: "session" }],
    });
    // Request sudah dijawab -> kedaluwarsa.
    expect(await reply("once")).toEqual({ ok: false, error: AGENT_REQUEST_GONE });

    const p2 = canUseTool(
      "Write",
      { file_path: "/x/y" },
      { signal, blockedPath: "/x", toolUseID: "t2", requestId: "r2" },
    );
    const asked2 = events.filter((e) => e.type === "permission.asked").at(-1);
    expect(data(asked2)).toMatchObject({ action: "external_directory", resources: ["/x"] });
    await client.permission.reply({
      sessionID: SID,
      requestID: String(data(asked2).id),
      decision: "reject",
    });
    expect(await p2).toMatchObject({ behavior: "deny" });
  });

  test("AskUserQuestion -> form.created; jawaban form dipetakan per teks pertanyaan", async () => {
    const { client, calls, events } = setup();
    await client.session.prompt({ sessionID: SID, text: "x" });
    await tick();
    const canUseTool = calls[0]?.options.canUseTool;
    if (!canUseTool) throw new Error("canUseTool");
    const input = {
      questions: [
        {
          question: "Which DB?",
          header: "DB",
          options: [
            { label: "Postgres", description: "" },
            { label: "SQLite", description: "" },
          ],
          multiSelect: false,
        },
        {
          question: "Extras?",
          header: "Extras",
          options: [
            { label: "Auth", description: "" },
            { label: "Cache", description: "" },
          ],
          multiSelect: true,
        },
      ],
    };
    const p = canUseTool("AskUserQuestion", input, {
      signal: new AbortController().signal,
      toolUseID: "t",
      requestId: "r",
    });
    const created = events.find((e) => e.type === "form.created");
    const form = data(created).form as { id: string; fields: Record<string, unknown>[] };
    expect(form.fields).toMatchObject([
      { key: "q0", type: "string", title: "DB", description: "Which DB?", custom: true },
      { key: "q1", type: "multiselect", title: "Extras", description: "Extras?" },
    ]);
    await client.form.reply({
      sessionID: SID,
      formID: form.id,
      answer: { q0: "SQLite", q1: ["Auth", "Cache"] },
    });
    expect(await p).toEqual({
      behavior: "allow",
      updatedInput: { ...input, answers: { "Which DB?": "SQLite", "Extras?": "Auth, Cache" } },
    });
  });

  test("interrupt: idle turn lama -> interrupted; prompt baru menunggu turn lama berhenti", async () => {
    const { client, calls, events } = setup();
    await client.session.prompt({ sessionID: SID, text: "first" });
    await tick();
    const q = calls[0]?.query;
    q?.push(state("running"));
    await tick();
    expect((await client.session.interrupt(SID)).ok).toBe(true);
    expect(q?.interrupted).toBe(1);

    let sent = false;
    const second = client.session.prompt({ sessionID: SID, text: "second" }).then(() => {
      sent = true;
    });
    await tick();
    expect(sent).toBe(false); // menunggu turn yang di-interrupt berhenti

    q?.push({ type: "result", subtype: "error_during_execution", is_error: true, errors: ["x"] });
    q?.push(state("idle"));
    await second;
    const ends = events.filter(
      (e) => e.type.startsWith("session.execution.") && e.type !== "session.execution.started",
    );
    expect(ends.map((e) => e.type)).toEqual(["session.execution.interrupted"]);
    expect(calls[0]?.inputs.length).toBe(2);

    q?.push(state("running"));
    q?.push(state("idle"));
    await tick();
    expect(events.at(-1)?.type).toBe("session.execution.succeeded");
  });

  test("proses mati di tengah turn -> session.execution.failed", async () => {
    const { client, calls, events } = setup();
    await client.session.prompt({ sessionID: SID, text: "x" });
    await tick();
    const q = calls[0]?.query;
    q?.push(state("running"));
    await tick();
    q?.end();
    await tick();
    expect(events.at(-1)).toMatchObject({
      type: "session.execution.failed",
      data: { sessionID: SID },
    });
  });

  test("gambar dikirim inline sebagai base64; @file dirujuk lewat path", async () => {
    const { client, calls } = setup();
    const file = path.join(import.meta.dir, "__fixture_claude.png");
    // Path absolut lintas OS (`/proj/…` di POSIX, `D:\proj\…` di Windows).
    const refPath = path.resolve("/proj/src/x.ts");
    await Bun.write(file, new Uint8Array([137, 80, 78, 71]));
    try {
      await client.session.prompt({
        sessionID: SID,
        text: "look",
        files: [
          { name: "a.png", mime: "image/png", uri: pathToFileURL(file).href },
          { name: "src/x.ts", mime: "text/plain", uri: pathToFileURL(refPath).href },
        ],
      });
      await tick();
      const content = calls[0]?.inputs[0]?.message.content as unknown as Record<string, unknown>[];
      expect(content[0]).toEqual({
        type: "text",
        text: `look\nReferenced files:\n- src/x.ts: ${refPath}`,
      });
      expect(content[1]).toMatchObject({
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "iVBORw==" },
      });
    } finally {
      await Bun.file(file).delete();
    }
  });

  test("model, agent, MCP, todos, hapus", async () => {
    const { client, calls, events, removed } = setup([SID]);
    const models = await client.model.list();
    expect(models).toEqual({
      ok: true,
      data: [
        {
          providerID: CLAUDE_PROVIDER_ID,
          providerName: "Claude Code",
          modelID: "sonnet",
          name: "Sonnet",
        },
      ],
    });
    // Query sementara untuk daftar model langsung ditutup & tidak dipersist.
    expect(calls[0]?.query.closed).toBe(true);
    expect(calls[0]?.options.persistSession).toBe(false);

    // Claude Code memakai permission mode (capability), bukan agent percakapan.
    expect(await client.agent.list()).toEqual({ ok: true, data: [] });
    expect(client.capabilities.permissionModes.map((m) => m.id)).toEqual([
      "default",
      "acceptEdits",
      "plan",
      "auto",
      "dontAsk",
      "bypassPermissions",
    ]);

    await client.session.prompt({ sessionID: SID, text: "x" });
    await tick();
    const q = calls[1]?.query;
    q?.push({
      type: "assistant",
      message: {
        id: "m",
        content: [
          { type: "tool_use", id: "t", name: "TodoWrite", input: { todos: [{ content: "a" }] } },
        ],
      },
      parent_tool_use_id: null,
      uuid: "u",
    });
    await tick();
    const todos = [{ content: "a", status: "pending", priority: "medium" }];
    expect(await client.session.todos(SID)).toEqual({ ok: true, data: todos });
    expect(events.find((e) => e.type === "agent.todos.updated")).toEqual({
      type: "agent.todos.updated",
      data: { sessionID: SID, todos },
    });
    expect(await client.mcp.list()).toEqual({
      ok: true,
      data: [{ name: "fs", status: "connected", error: null }],
    });

    expect((await client.session.remove(SID)).ok).toBe(true);
    expect(q?.closed).toBe(true);
    expect(removed).toEqual([SID]);
  });
});

describe("permission mode Claude Code", () => {
  test("mode baru: spawn dengan permissionMode; mode tak dikenal ditolak", async () => {
    const { client, calls } = setup();
    expect(await client.session.setPermissionMode(SID, "yolo")).toEqual({
      ok: false,
      error: "INVALID_PERMISSION_MODE",
    });
    expect((await client.session.setPermissionMode(SID, "acceptEdits")).ok).toBe(true);
    expect(calls.length).toBe(0); // tanpa proses: dipakai saat spawn
    await client.session.prompt({ sessionID: SID, text: "x" });
    await tick();
    expect(calls[0]?.options.permissionMode).toBe("acceptEdits");
    // Pindah ke bypass nanti hanya DIIZINKAN, tidak diaktifkan.
    expect(calls[0]?.options.allowDangerouslySkipPermissions).toBe(true);
  });

  test("ganti mode di tengah turn -> setPermissionMode langsung ke proses", async () => {
    const { client, calls } = setup();
    await client.session.prompt({ sessionID: SID, text: "x" });
    await tick();
    const q = calls[0]?.query;
    q?.push(state("running"));
    await tick();
    expect((await client.session.setPermissionMode(SID, "plan")).ok).toBe(true);
    expect(q?.modes).toEqual(["plan"]);
    // Mode sama tidak dikirim ulang.
    await client.session.setPermissionMode(SID, "plan");
    expect(q?.modes).toEqual(["plan"]);
  });

  test("mode dari CLI (init/status) dipancarkan sekali per perubahan", async () => {
    const { client, calls, events } = setup();
    await client.session.prompt({ sessionID: SID, text: "x" });
    await tick();
    const q = calls[0]?.query;
    q?.push({ type: "system", subtype: "init", permissionMode: "default", mcp_servers: [] });
    q?.push({ type: "system", subtype: "status", status: null, permissionMode: "default" });
    q?.push({ type: "system", subtype: "status", status: null, permissionMode: "acceptEdits" });
    await tick();
    const changes = events.filter((e) => e.type === "agent.permission_mode.changed").map(data);
    expect(changes.map((d) => d.mode)).toEqual(["default", "acceptEdits"]);
    // Mode yang dilaporkan menjadi acuan: memilih mode yang sama tidak memicu kontrol.
    await client.session.setPermissionMode(SID, "acceptEdits");
    expect(q?.modes).toEqual([]);
  });

  test("ExitPlanMode -> form rencana; setuju mengganti mode, masukan menolak dengan pesan", async () => {
    const { client, calls, events } = setup();
    await client.session.prompt({ sessionID: SID, text: "x" });
    await tick();
    const canUseTool = calls[0]?.options.canUseTool;
    if (!canUseTool) throw new Error("canUseTool");
    const opts = { signal: new AbortController().signal, toolUseID: "t", requestId: "r" };
    const input = { plan: "## Rencana\n1. Ubah a.ts" };

    const p1 = canUseTool("ExitPlanMode", input, opts);
    const form1 = data(events.find((e) => e.type === "form.created")).form as {
      id: string;
      metadata: Record<string, unknown>;
      fields: { key: string; options: { value: string }[] }[];
    };
    expect(form1.metadata).toEqual({ kind: "plan", plan: input.plan });
    expect(form1.fields[0]?.options.map((o) => o.value)).toEqual([
      "acceptEdits",
      "default",
      "plan",
    ]);
    await client.form.reply({
      sessionID: SID,
      formID: form1.id,
      answer: { decision: "acceptEdits" },
    });
    expect(await p1).toEqual({
      behavior: "allow",
      updatedInput: input,
      updatedPermissions: [{ type: "setMode", mode: "acceptEdits", destination: "session" }],
    });

    const p2 = canUseTool("ExitPlanMode", input, opts);
    const form2 = data(events.filter((e) => e.type === "form.created").at(-1)).form as {
      id: string;
    };
    await client.form.reply({
      sessionID: SID,
      formID: form2.id,
      answer: { decision: "Tambah test dulu" },
    });
    expect(await p2).toEqual({
      behavior: "deny",
      message: "The user wants changes to the plan before implementing it: Tambah test dulu",
    });

    const p3 = canUseTool("ExitPlanMode", input, opts);
    const form3 = data(events.filter((e) => e.type === "form.created").at(-1)).form as {
      id: string;
    };
    expect((await client.form.cancel({ sessionID: SID, formID: form3.id })).ok).toBe(true);
    expect(await p3).toMatchObject({ behavior: "deny" });
  });
});
