/**
 * Penerjemah pesan SDK Claude Code -> `AgentEvent` (bentuk opencode v2):
 * helper nama tool/permission & input, serta `ClaudeTurnTranslator`.
 */
import { describe, expect, test } from "bun:test";
import { todosFromInput } from "../../todos";
import type { AgentEvent } from "../../types";
import { ClaudeTurnTranslator, normalizeToolInput, permissionName, toolName } from "../translate";
import { data, SID } from "./harness";

function translator() {
  const events: AgentEvent[] = [];
  const t = new ClaudeTurnTranslator(SID, (ev) => events.push(ev));
  return { t, events };
}

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
