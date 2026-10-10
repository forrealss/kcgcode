/**
 * Backend Claude Code: penerjemah pesan SDK -> event gaya opencode, dan
 * klien in-process (spawn malas, permission/question lewat `canUseTool`,
 * interrupt, resume) dengan `query()` palsu.
 */
import { describe, expect, test } from "bun:test";
import type { Options, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  CLAUDE_PROVIDER_ID,
  type ClaudeQueryLike,
  createClaudeCodeClient,
} from "../claude-code-client";
import {
  ClaudeTurnTranslator,
  normalizeToolInput,
  permissionName,
  todosFromInput,
  toolName,
} from "../claude-code-translate";
import type { OpenCodeEvent } from "../opencode-client";
import { OC_REQUEST_GONE } from "../opencode-client";

const SID = "11111111-1111-4111-8111-111111111111";

function translator() {
  const events: OpenCodeEvent[] = [];
  const t = new ClaudeTurnTranslator(
    SID,
    (ev) => events.push(ev),
    () => 1000,
  );
  return { t, events };
}

const streamEvent = (event: Record<string, unknown>, parent: string | null = null) => ({
  type: "stream_event",
  event,
  parent_tool_use_id: parent,
  uuid: "u",
  session_id: SID,
});

describe("claude-code-translate helpers", () => {
  test("nama tool & permission dinormalisasi ke gaya opencode", () => {
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
  test("stream text -> part + delta; blok yang sama di pesan assistant dilewati", () => {
    const { t, events } = translator();
    t.beginTurn();
    const msgId = (events[0]?.info as { id: string } | undefined)?.id;
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

    expect(events.map((e) => e.type)).toEqual([
      "message.updated",
      "message.part.updated",
      "message.part.delta",
      "message.part.updated",
    ]);
    expect(events[2]).toMatchObject({ messageID: msgId, partID: "prt_api_1_0", delta: "Hi" });
    expect(events[3]).toMatchObject({
      part: { id: "prt_api_1_0", type: "text", text: "Hi", messageID: msgId },
    });
  });

  test("thinking -> part reasoning", () => {
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
    expect(events.at(-1)).toMatchObject({ part: { type: "reasoning", text: "hmm" } });
  });

  test("thinking tanpa token (disembunyikan provider) tidak menjadi part kosong", () => {
    const { t, events } = translator();
    t.beginTurn();
    t.handle(streamEvent({ type: "message_start", message: { id: "api_h" } }));
    t.handle(
      streamEvent({ type: "content_block_start", index: 0, content_block: { type: "thinking" } }),
    );
    t.handle(streamEvent({ type: "content_block_stop", index: 0 }));
    expect(events.map((e) => e.type)).toEqual(["message.updated"]);
  });

  test("pesan assistant tanpa stream (fallback) tetap menghasilkan teks", () => {
    const { t, events } = translator();
    t.beginTurn();
    t.handle({
      type: "assistant",
      message: { id: "api_x", content: [{ type: "text", text: "done" }] },
      parent_tool_use_id: null,
      uuid: "a9",
    });
    expect(events.at(-1)).toMatchObject({ part: { type: "text", text: "done" } });
  });

  test("tool_use -> running, tool_result -> completed + output; TodoWrite -> todos", () => {
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
    expect(events[1]).toMatchObject({
      part: {
        id: "prt_toolu_1",
        type: "tool",
        tool: "read",
        state: { status: "running", input: { filePath: "/p/a.ts" } },
      },
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
      part: {
        id: "prt_toolu_1",
        state: { status: "completed", output: "file body", input: { filePath: "/p/a.ts" } },
      },
    });

    t.handle({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_2", content: "no", is_error: true }],
      },
      parent_tool_use_id: null,
    });
    expect(events.at(-1)).toMatchObject({ part: { state: { status: "error" } } });
  });

  test("api_retry -> session.status retry (banner)", () => {
    const { t, events } = translator();
    t.handle({
      type: "system",
      subtype: "api_retry",
      attempt: 2,
      error: "rate_limit",
      error_status: 429,
    });
    expect(events[0]).toMatchObject({
      type: "session.status",
      status: { type: "retry", attempt: 2, message: "rate limit (HTTP 429)" },
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
  const client = createClaudeCodeClient("/proj", {
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
  const events: OpenCodeEvent[] = [];
  client.subscribeEvents((ev) => events.push(ev));
  return { client, calls, events, removed };
}

const state = (s: string) => ({ type: "system", subtype: "session_state_changed", state: s });

describe("ClaudeCodeClient", () => {
  test("prompt pertama spawn proses dengan settings user & sessionId baru", async () => {
    const { client, calls, events } = setup();
    const created = await client.createSession();
    if (!created.ok) throw new Error("create");
    expect(calls.length).toBe(0); // malas: belum ada proses

    const res = await client.promptAsync(created.data.id, "hello", {
      providerID: CLAUDE_PROVIDER_ID,
      modelID: "sonnet",
    });
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
    expect(events[0]).toMatchObject({ type: "message.updated", sessionID: created.data.id });
  });

  test("transcript sudah ada -> resume; model/mode diganti lewat kontrol", async () => {
    const { client, calls } = setup([SID]);
    expect((await client.getSession(SID)).ok).toBe(true);
    await client.promptAsync(SID, "a", null, [], "plan");
    await tick();
    expect(calls[0]?.options.resume).toBe(SID);
    expect(calls[0]?.options.sessionId).toBeUndefined();
    expect(calls[0]?.options.permissionMode).toBe("plan");

    await client.promptAsync(
      SID,
      "b",
      { providerID: CLAUDE_PROVIDER_ID, modelID: "opus" },
      [],
      null,
    );
    await tick();
    expect(calls.length).toBe(1); // proses dipakai ulang
    expect(calls[0]?.query.models).toEqual(["opus"]);
    expect(calls[0]?.query.modes).toEqual(["default"]);
    expect(calls[0]?.inputs.length).toBe(2);
  });

  test("session_state idle -> session.idle; result error -> session.error", async () => {
    const { client, calls, events } = setup();
    await client.promptAsync(SID, "x");
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
    const types = events.map((e) => e.type);
    expect(types).toContain("session.error");
    expect(types.at(-1)).toBe("session.idle");
    expect(events.find((e) => e.type === "session.error")).toMatchObject({
      error: { data: { message: "boom" } },
    });
  });

  test("permission: canUseTool -> permission.asked; reply once/always/reject", async () => {
    const { client, calls, events } = setup();
    await client.promptAsync(SID, "x");
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
      {
        signal,
        suggestions,
        toolUseID: "t1",
        requestId: "r1",
      },
    );
    const asked = events.find((e) => e.type === "permission.asked");
    expect(asked).toMatchObject({ sessionID: SID, permission: "bash", patterns: ["git status"] });
    const id = String(asked?.requestID);
    expect((await client.replyPermission(id, "always")).ok).toBe(true);
    expect(await p1).toEqual({
      behavior: "allow",
      updatedInput: { command: "git status" },
      // "Always" berlaku per Session, tidak menulis file settings.
      updatedPermissions: [{ ...rule, destination: "session" }],
    });
    // Request sudah dijawab -> kedaluwarsa.
    expect(await client.replyPermission(id, "once")).toEqual({ ok: false, error: OC_REQUEST_GONE });

    const p2 = canUseTool(
      "Write",
      { file_path: "/x/y" },
      {
        signal,
        blockedPath: "/x",
        toolUseID: "t2",
        requestId: "r2",
      },
    );
    const asked2 = events.filter((e) => e.type === "permission.asked").at(-1);
    expect(asked2).toMatchObject({ permission: "external_directory", patterns: ["/x"] });
    await client.replyPermission(String(asked2?.requestID), "reject");
    expect(await p2).toMatchObject({ behavior: "deny" });
  });

  test("AskUserQuestion -> question.asked; jawaban dipetakan per teks pertanyaan", async () => {
    const { client, calls, events } = setup();
    await client.promptAsync(SID, "x");
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
    const asked = events.find((e) => e.type === "question.asked");
    expect(asked).toMatchObject({
      questions: [
        { question: "Which DB?", multiple: false, custom: true },
        { question: "Extras?", multiple: true },
      ],
    });
    await client.replyQuestion(String(asked?.requestID), [["SQLite"], ["Auth", "Cache"]]);
    expect(await p).toEqual({
      behavior: "allow",
      updatedInput: { ...input, answers: { "Which DB?": "SQLite", "Extras?": "Auth, Cache" } },
    });
  });

  test("interrupt: idle turn lama ditelan, prompt baru menunggu sampai turn lama berhenti", async () => {
    const { client, calls, events } = setup();
    await client.promptAsync(SID, "first");
    await tick();
    const q = calls[0]?.query;
    q?.push(state("running"));
    await tick();
    expect((await client.abortSession(SID)).ok).toBe(true);
    expect(q?.interrupted).toBe(1);

    let sent = false;
    const second = client.promptAsync(SID, "second").then(() => {
      sent = true;
    });
    await tick();
    expect(sent).toBe(false); // menunggu turn yang di-interrupt berhenti

    q?.push({ type: "result", subtype: "error_during_execution", is_error: true, errors: ["x"] });
    q?.push(state("idle"));
    await second;
    expect(events.some((e) => e.type === "session.idle")).toBe(false);
    expect(events.some((e) => e.type === "session.error")).toBe(false);
    expect(calls[0]?.inputs.length).toBe(2);

    q?.push(state("running"));
    q?.push(state("idle"));
    await tick();
    expect(events.filter((e) => e.type === "session.idle").length).toBe(1);
  });

  test("proses mati di tengah turn -> session.error + session.idle", async () => {
    const { client, calls, events } = setup();
    await client.promptAsync(SID, "x");
    await tick();
    const q = calls[0]?.query;
    q?.push(state("running"));
    await tick();
    q?.end();
    await tick();
    expect(events.at(-1)).toMatchObject({ type: "session.idle", sessionID: SID });
  });

  test("gambar dikirim inline sebagai base64", async () => {
    const { client, calls } = setup();
    const file = `${import.meta.dir}/__fixture_claude.png`;
    await Bun.write(file, new Uint8Array([137, 80, 78, 71]));
    try {
      await client.promptAsync(SID, "look", null, [
        { filename: "a.png", mime: "image/png", url: `file://${file}` },
        { filename: "src/x.ts", mime: "text/plain", url: "file:///proj/src/x.ts" },
      ]);
      await tick();
      const content = calls[0]?.inputs[0]?.message.content as unknown as Record<string, unknown>[];
      expect(content[0]).toEqual({
        type: "text",
        text: "look\nReferenced files:\n- src/x.ts: /proj/src/x.ts",
      });
      expect(content[1]).toMatchObject({
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "iVBORw==" },
      });
    } finally {
      await Bun.file(file).delete();
    }
  });

  test("model, agent, MCP, todos, delete", async () => {
    const { client, calls, removed } = setup([SID]);
    const models = await client.listModels();
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

    const agents = await client.listAgents();
    expect(agents.ok && agents.data.map((a) => a.name)).toEqual(["default", "acceptEdits", "plan"]);

    await client.promptAsync(SID, "x");
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
    expect(await client.listTodos(SID)).toEqual({
      ok: true,
      data: [{ content: "a", status: "pending", priority: "medium" }],
    });
    expect(await client.listMcp()).toEqual({
      ok: true,
      data: [{ name: "fs", status: "connected", error: null }],
    });

    expect((await client.deleteSession(SID)).ok).toBe(true);
    expect(q?.closed).toBe(true);
    expect(removed).toEqual([SID]);
  });
});
