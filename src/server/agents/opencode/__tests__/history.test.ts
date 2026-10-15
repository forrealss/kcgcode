/**
 * Riwayat Session opencode v2 (`message.list`) -> pesan KCG (`history.ts`).
 */
import { describe, expect, test } from "bun:test";
import { historyFromMessages } from "../history";

describe("historyFromMessages", () => {
  test("user + step assistant: id & part sama dengan proyeksi live", () => {
    const out = historyFromMessages([
      {
        id: "msg_u1",
        type: "user",
        time: { created: 100 },
        text: "[Image 1] fix this",
        files: [
          {
            data: "AAAA",
            mime: "image/png",
            source: { type: "inline" },
            name: "shot.png",
          },
          { data: "", mime: "text/plain", source: { type: "uri", uri: "file:///p/a.ts" } },
        ],
      },
      {
        id: "msg_a1",
        type: "assistant",
        time: { created: 110, completed: 150 },
        agent: "build",
        model: { id: "m", providerID: "p" },
        content: [
          { type: "reasoning", text: "", state: { openai: { encrypted: "x" } } },
          { type: "reasoning", text: "thinking" },
          { type: "text", text: "Looking." },
          {
            type: "tool",
            id: "call_1",
            name: "read",
            state: {
              status: "completed",
              input: { filePath: "/p/a.ts" },
              content: [{ type: "text", text: "1: hi" }],
              metadata: { preview: "hi" },
            },
            time: { created: 120, completed: 130 },
          },
          {
            type: "tool",
            id: "call_2",
            name: "shell",
            state: {
              status: "error",
              input: { command: "false" },
              error: { type: "tool", message: "exit 1" },
            },
            time: { created: 131, completed: 132 },
          },
          {
            type: "tool",
            id: "call_3",
            name: "edit",
            state: { status: "running", input: { filePath: "x" }, metadata: {} },
            time: { created: 140 },
          },
        ],
        finish: "tool-calls",
      },
    ]);
    expect(out).toEqual([
      {
        id: "msg_u1",
        role: "user",
        parts: [
          { type: "text", text: "[Image 1] fix this" },
          { type: "file", mime: "image/png", filename: "shot.png" },
          { type: "file", mime: "text/plain", filename: "a.ts", url: "file:///p/a.ts" },
        ],
        createdAt: 100,
      },
      {
        id: "msg_a1",
        role: "assistant",
        createdAt: 110,
        parts: [
          {
            id: "prt_msg_a1_reasoning_1",
            type: "reasoning",
            text: "thinking",
            time: { start: 110, end: 150 },
          },
          {
            id: "prt_msg_a1_text_0",
            type: "text",
            text: "Looking.",
            time: { start: 110, end: 150 },
          },
          {
            id: "prt_call_1",
            type: "tool",
            tool: "read",
            callID: "call_1",
            state: {
              status: "completed",
              input: { filePath: "/p/a.ts" },
              output: "1: hi",
              metadata: { preview: "hi" },
              time: { start: 120, end: 130 },
            },
          },
          {
            id: "prt_call_2",
            type: "tool",
            tool: "shell",
            callID: "call_2",
            state: {
              status: "error",
              input: { command: "false" },
              error: "exit 1",
              time: { start: 131, end: 132 },
            },
          },
          {
            id: "prt_call_3",
            type: "tool",
            tool: "edit",
            callID: "call_3",
            state: {
              status: "error",
              input: { filePath: "x" },
              error: "No result was recorded for this tool call.",
              time: { start: 140 },
            },
          },
        ],
      },
    ]);
  });

  test("pesan harness disembunyikan; compact, shell, dan error menjadi part", () => {
    const out = historyFromMessages([
      { id: "msg_s", type: "synthetic", time: { created: 1 }, text: "Called the Read tool…" },
      { id: "msg_sys", type: "system", time: { created: 2 }, text: "tools changed" },
      { id: "msg_sk", type: "skill", time: { created: 3 }, skill: "s", name: "s", text: "…" },
      { id: "msg_ag", type: "agent-switched", time: { created: 4 } },
      {
        id: "msg_c",
        type: "compaction",
        time: { created: 5 },
        status: "completed",
        reason: "manual",
        summary: "…",
        recent: "",
      },
      {
        id: "msg_cf",
        type: "compaction",
        time: { created: 6 },
        status: "failed",
        reason: "auto",
        error: { type: "x", message: "y" },
      },
      {
        id: "msg_sh",
        type: "shell",
        time: { created: 7, completed: 8 },
        shellID: "sh",
        command: "ls",
        status: "exited",
        exit: 0,
        output: { output: "a\nb", cursor: 0, size: 3, truncated: false },
      },
      {
        id: "msg_ab",
        type: "assistant",
        time: { created: 9 },
        content: [{ type: "reasoning", text: "half" }],
        error: { type: "aborted", message: "Aborted" },
      },
      {
        id: "msg_e",
        type: "assistant",
        time: { created: 10, completed: 11 },
        content: [],
        error: { type: "provider.auth", message: "Invalid API key\nmore" },
      },
      // Error yang sama sudah tercatat di step terakhir -> tidak dobel.
      {
        id: "msg_i1",
        type: "idle",
        time: { created: 11 },
        outcome: "failed",
        error: { type: "provider.auth", message: "Invalid API key" },
      },
      // Waktu mundur dijepit agar urutan timeline tetap.
      { id: "msg_u", type: "user", time: { created: 3 }, text: "next" },
      // Gagal sebelum ada step (model tidak tersedia) -> error; dibatalkan -> tidak.
      {
        id: "msg_i2",
        type: "idle",
        time: { created: 12 },
        outcome: "failed",
        error: { type: "provider.no-route", message: "Model unavailable: x/y" },
      },
      { id: "msg_i3", type: "idle", time: { created: 13 }, outcome: "interrupted" },
    ]);
    expect(out).toEqual([
      {
        id: "msg_c",
        role: "assistant",
        parts: [
          {
            id: "prt_msg_c_compaction_0",
            type: "compaction",
            trigger: "manual",
            time: { created: 5 },
          },
        ],
        createdAt: 5,
      },
      {
        id: "msg_sh",
        role: "assistant",
        parts: [
          {
            id: "prt_msg_sh_shell",
            type: "tool",
            tool: "shell",
            callID: "msg_sh",
            state: {
              status: "completed",
              input: { command: "ls" },
              output: "a\nb",
              time: { start: 7, end: 8 },
            },
          },
        ],
        createdAt: 7,
      },
      {
        id: "msg_ab",
        role: "assistant",
        parts: [
          {
            id: "prt_msg_ab_reasoning_0",
            type: "reasoning",
            text: "half",
            time: { start: 9, end: 9 },
          },
        ],
        createdAt: 9,
      },
      {
        id: "err_msg_e",
        role: "assistant",
        parts: [{ type: "error", text: "Invalid API key" }],
        createdAt: 11,
      },
      { id: "msg_u", role: "user", parts: [{ type: "text", text: "next" }], createdAt: 11 },
      {
        id: "err_msg_i2",
        role: "assistant",
        parts: [{ type: "error", text: "Model unavailable: x/y" }],
        createdAt: 12,
      },
    ]);
  });
});
