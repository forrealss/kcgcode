/**
 * Agent_Projector & helper `session-events`: siklus part tool, form question
 * <-> jawaban kartu, dan deskripsi error terstruktur.
 */
import { describe, expect, test } from "bun:test";
import { openSessionStore } from "../../../db";
import type { InteractivePrompt, MessagePart } from "../../../types";
import type { AgentForm } from "../../agents/types";
import { AgentEventProjector, toolContentText } from "../agent-projector";
import {
  describeAgentError,
  formAnswerFromLabels,
  labelsFromResponse,
  promptFromForm,
} from "../session-events";
import { TurnStream } from "../turn-stream";

function harness() {
  const store = openSessionStore(":memory:");
  const parts: MessagePart[] = [];
  const prompts: InteractivePrompt[] = [];
  const turns = new TurnStream({
    store,
    now: () => 1000,
    onMessagePart: (_s, _m, p) => parts.push(p),
    setTimeoutFn: () => 0,
    clearTimeoutFn: () => {},
  });
  const projector = new AgentEventProjector({
    turns,
    now: () => 1000,
    resolve: (id) => (id === "ses_1" || id === "ses_child" ? "local" : undefined),
    isRoot: (_s, id) => id === "ses_1",
    mapChild: () => {},
    setTitle: () => {},
    insertPrompt: () => true,
    onPrompt: (p) => prompts.push(p),
  });
  turns.begin("local", 60_000, "timeout");
  return { projector, parts, prompts, store };
}

const base = { sessionID: "ses_1", assistantMessageID: "msg_1", id: "call_1" };

describe("AgentEventProjector — tool", () => {
  test("pending -> running -> completed membawa nama, input & output", () => {
    const { projector, parts } = harness();
    projector.handle({
      type: "session.step.started",
      data: { sessionID: "ses_1", assistantMessageID: "msg_1" },
    });
    projector.handle({ type: "session.tool.input.started", data: { ...base, name: "read" } });
    projector.handle({ type: "session.tool.called", data: { ...base, input: { path: "a.ts" } } });
    projector.handle({
      type: "session.tool.success",
      data: { ...base, content: [{ type: "text", text: "isi" }], metadata: { truncated: false } },
    });
    expect(parts.map((p) => (p.state as { status: string }).status)).toEqual([
      "pending",
      "running",
      "completed",
    ]);
    expect(parts.at(-1)).toEqual({
      id: "prt_call_1",
      type: "tool",
      tool: "read",
      callID: "call_1",
      messageID: "msg_1",
      state: {
        status: "completed",
        input: { path: "a.ts" },
        output: "isi",
        metadata: { truncated: false },
        time: { start: 1000, end: 1000 },
      },
    });
  });

  test("tool gagal -> status error dengan pesan", () => {
    const { projector, parts } = harness();
    projector.handle({
      type: "session.step.started",
      data: { sessionID: "ses_1", assistantMessageID: "msg_1" },
    });
    projector.handle({
      type: "session.tool.called",
      data: { ...base, name: "shell", input: { command: "x" } },
    });
    projector.handle({
      type: "session.tool.failed",
      data: { ...base, error: { type: "tool", message: "exit 1" } },
    });
    expect(parts.at(-1)).toMatchObject({
      tool: "shell",
      state: { status: "error", error: "exit 1", input: { command: "x" } },
    });
  });

  test("output tool panjang dipotong", () => {
    const long = "x".repeat(60_000);
    expect(toolContentText([{ type: "text", text: long }]).endsWith("… (truncated)")).toBe(true);
    expect(toolContentText([{ type: "image" }])).toBe("[image]");
  });
});

describe("form question", () => {
  const form: AgentForm = {
    id: "frm_1",
    sessionID: "ses_1",
    title: "Questions",
    fields: [
      {
        key: "color",
        type: "string",
        title: "Color",
        description: "Which color?",
        options: [
          { value: "red", label: "Red" },
          { value: "blue", label: "Blue" },
        ],
      },
      {
        key: "extras",
        type: "multiselect",
        description: "Extras?",
        options: [
          { value: "a", label: "Auth" },
          { value: "c", label: "Cache" },
        ],
      },
      { key: "ok", type: "boolean", description: "Lanjut?" },
      { key: "internal", type: "string", hidden: true },
    ],
  };

  test("form -> prompt question (field tersembunyi dilewati, boolean jadi Yes/No)", () => {
    const p = promptFromForm(form, "local", 1);
    expect(p).toMatchObject({ id: "frm_1", kind: "question", type: "menu", title: "Which color?" });
    expect(p.questions?.map((q) => [q.question, q.header, q.multiple ?? false])).toEqual([
      ["Which color?", "Color", false],
      ["Extras?", null, true],
      ["Lanjut?", null, false],
    ]);
    expect(p.questions?.[2]?.options?.map((o) => o.label)).toEqual(["Yes", "No"]);
  });

  test("label kartu -> jawaban form memakai `value` opsi dan tipe field", () => {
    expect(formAnswerFromLabels(form, [["Blue"], ["Auth", "Cache"], ["Yes"]])).toEqual({
      color: "blue",
      extras: ["a", "c"],
      ok: true,
    });
    // Tanpa definisi form (setelah restart): kunci q<i>, label sebagai nilai.
    expect(formAnswerFromLabels(undefined, [["Red"], ["A", "B"]])).toEqual({
      q0: "Red",
      q1: ["A", "B"],
    });
  });

  test("respon kartu -> label per pertanyaan", () => {
    expect(labelsFromResponse({ option: "A" })).toEqual([["A"]]);
    expect(labelsFromResponse({ options: ["A", "B"] })).toEqual([["A", "B"]]);
    expect(labelsFromResponse({ answers: [["A"], ["B"]] })).toEqual([["A"], ["B"]]);
    expect(labelsFromResponse("approve")).toBeNull();
  });
});

test("describeAgentError: kategori -> petunjuk + baris pertama pesan", () => {
  expect(describeAgentError({ type: "provider.auth", message: "401\nstack" })).toBe(
    "Model provider authentication failed. Check the agent login. — 401",
  );
  expect(describeAgentError({ type: "provider.transport", message: "ConnectionRefused" })).toBe(
    "Couldn't reach the model provider. — ConnectionRefused",
  );
  expect(describeAgentError({ type: "unknown", message: "boom" })).toBe("boom");
  expect(describeAgentError(undefined)).toBe("Something went wrong while processing the prompt.");
});
