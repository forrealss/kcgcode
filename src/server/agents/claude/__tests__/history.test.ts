/**
 * Unit test `historyFromTranscript`: transcript Claude Code (bentuk
 * `getSessionMessages`) -> pesan KCG dengan part yang sama seperti turn live.
 */
import { describe, expect, test } from "bun:test";
import { historyFromTranscript } from "../history";
import type { ClaudeTranscriptMessage } from "../sdk";

let seq = 0;
/** Pesan transcript ringkas; waktu naik 1 detik per pesan. */
function msg(
  type: "user" | "assistant",
  content: unknown,
  extra: Partial<ClaudeTranscriptMessage> = {},
): ClaudeTranscriptMessage {
  seq += 1;
  return {
    type,
    uuid: `u${seq}`,
    session_id: "s1",
    message: { role: type, content },
    parent_tool_use_id: null,
    parent_agent_id: null,
    timestamp: new Date(Date.UTC(2026, 9, 15, 0, 0, seq)).toISOString(),
    ...extra,
  };
}
const user = (content: unknown, extra?: Partial<ClaudeTranscriptMessage>) =>
  msg("user", content, extra);
const assistant = (content: unknown, extra?: Partial<ClaudeTranscriptMessage>) =>
  msg("assistant", content, extra);

describe("historyFromTranscript", () => {
  test("prompt -> pesan user; seluruh pesan API satu turn -> SATU pesan assistant", () => {
    const t = [
      user("fix the bug"),
      assistant([{ type: "thinking", thinking: "let me look" }]),
      assistant([
        { type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "/p/a.ts" } },
      ]),
      user([{ type: "tool_result", tool_use_id: "toolu_1", content: "file body" }]),
      assistant([{ type: "text", text: "Fixed it." }]),
    ];
    const out = historyFromTranscript(t);
    expect(out.map((m) => m.role)).toEqual(["user", "assistant"]);
    const [u, a] = out;
    expect(u?.id).toBe(`usr_${t[0]?.uuid}`);
    expect(u?.parts).toEqual([{ type: "text", text: "fix the bug" }]);
    expect(u?.createdAt).toBe(Date.parse(t[0]?.timestamp as string));

    expect(a?.id).toBe(`msg_${t[1]?.uuid}`);
    expect(a?.parts.map((p) => p.type)).toEqual(["reasoning", "tool", "text"]);
    expect(a?.parts[0]).toMatchObject({ id: `prt_${a?.id}_reasoning_0`, text: "let me look" });
    expect(a?.parts[2]).toMatchObject({ id: `prt_${a?.id}_text_0`, text: "Fixed it." });
    // Tool: nama & input dinormalisasi seperti turn live; status dari tool_result.
    expect(a?.parts[1]).toMatchObject({
      id: "prt_toolu_1",
      type: "tool",
      tool: "read",
      callID: "toolu_1",
      state: {
        status: "completed",
        output: "file body",
        input: { file_path: "/p/a.ts", filePath: "/p/a.ts" },
      },
    });
    const time = a?.parts[1]?.state?.time as { start: number; end: number };
    expect(time.end).toBeGreaterThan(time.start);
  });

  test("tool_result error -> status error; tool tanpa hasil -> error", () => {
    const out = historyFromTranscript([
      user("go"),
      assistant([
        { type: "tool_use", id: "t1", name: "Bash", input: { command: "false" } },
        { type: "tool_use", id: "t2", name: "Bash", input: { command: "sleep 9" } },
      ]),
      user([
        {
          type: "tool_result",
          tool_use_id: "t1",
          is_error: true,
          content: [{ type: "text", text: "exit 1" }],
        },
      ]),
    ]);
    const tools = out[1]?.parts ?? [];
    expect(tools[0]?.state).toMatchObject({ status: "error", error: "exit 1", output: "exit 1" });
    expect(tools[1]?.state).toMatchObject({ status: "error" });
  });

  test("pesan buatan harness disembunyikan tapi menutup turn", () => {
    const out = historyFromTranscript([
      user("start a sub-agent"),
      assistant([{ type: "text", text: "Started." }]),
      user("<task-notification>\n<task-id>a1</task-id>\n</task-notification>", {
        origin: { kind: "task-notification" },
      }),
      assistant([{ type: "text", text: "The agent finished." }]),
      user("<system-reminder>ctx</system-reminder>"),
      assistant([{ type: "text", text: "Noted." }]),
    ]);
    expect(out.map((m) => m.role)).toEqual(["user", "assistant", "assistant", "assistant"]);
    expect(out.slice(1).map((m) => m.parts[0]?.text)).toEqual([
      "Started.",
      "The agent finished.",
      "Noted.",
    ]);
  });

  test("system reminder di dalam prompt user dibuang; slash command ditampilkan apa adanya", () => {
    const out = historyFromTranscript([
      user([
        { type: "text", text: "<system-reminder>be nice</system-reminder>" },
        { type: "text", text: "real question" },
      ]),
      user(
        "<command-name>/review</command-name>\n<command-message>review</command-message>\n<command-args>42</command-args>",
      ),
    ]);
    expect(out.map((m) => m.parts[0]?.text)).toEqual(["real question", "/review 42"]);
  });

  test("gambar -> part file (tanpa bytes); ringkasan compact -> part compaction", () => {
    const out = historyFromTranscript([
      user([
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "xx" } },
        { type: "text", text: "what is this?" },
      ]),
      assistant([{ type: "text", text: "A cat." }]),
      user("This session is being continued from a previous conversation that ran out of…"),
      assistant([{ type: "text", text: "Continuing." }]),
    ]);
    expect(out[0]?.parts).toEqual([
      { type: "text", text: "what is this?" },
      { type: "file", mime: "image/jpeg", filename: "image-1.jpeg" },
    ]);
    expect(out.map((m) => m.parts[0]?.type)).toEqual(["text", "text", "compaction", "text"]);
    // Penanda compact berdiri sendiri; balasan berikutnya turn baru.
    expect(out[2]?.id).not.toBe(out[3]?.id);
  });

  test("konten sub-agent dilewati; waktu monoton walau timestamp hilang", () => {
    const out = historyFromTranscript(
      [
        user("hi", { timestamp: undefined }),
        assistant([{ type: "text", text: "inner" }], { parent_tool_use_id: "toolu_x" }),
        assistant([{ type: "text", text: "outer" }], { timestamp: "bogus" }),
      ],
      5000,
    );
    expect(out.map((m) => [m.role, m.parts[0]?.text, m.createdAt])).toEqual([
      ["user", "hi", 5000],
      ["assistant", "outer", 5000],
    ]);
  });
});
