/**
 * Unit test helper murni engine percakapan Session (`lib/session-chat.ts`)
 * yang dipakai `useSessionChat` — tanpa render React.
 */
import { describe, expect, test } from "bun:test";
import type { InteractivePrompt, SessionMessage } from "@/types";
import {
  appendPrompt,
  createOptimisticMessage,
  hasPendingQuestionPrompt,
  isPromptCardErrorCode,
  isStreamingAssistant,
  OPTIMISTIC_ID,
  thoughtBlockKeys,
} from "../session-chat";

function msg(
  id: string,
  role: SessionMessage["role"],
  parts: SessionMessage["parts"],
  streaming?: boolean,
): SessionMessage {
  return { id, sessionId: "s1", role, parts, createdAt: 0, streaming };
}

function prompt(id: string, kind: InteractivePrompt["kind"]): InteractivePrompt {
  return { id, kind } as InteractivePrompt;
}

describe("createOptimisticMessage", () => {
  test("pesan user dengan id optimistis dan satu part teks", () => {
    const m = createOptimisticMessage("s1", "halo");
    expect(m.id).toBe(OPTIMISTIC_ID);
    expect(m.sessionId).toBe("s1");
    expect(m.role).toBe("user");
    expect(m.parts).toEqual([{ type: "text", text: "halo" }]);
    expect(m.streaming).toBeUndefined();
  });
});

describe("appendPrompt", () => {
  test("menambahkan prompt baru di akhir", () => {
    const prev = [prompt("a", "permission")];
    const next = appendPrompt(prev, prompt("b", "question"));
    expect(next.map((p) => p.id)).toEqual(["a", "b"]);
    expect(prev).toHaveLength(1);
  });

  test("id duplikat -> array yang sama", () => {
    const prev = [prompt("a", "permission")];
    expect(appendPrompt(prev, prompt("a", "permission"))).toBe(prev);
  });
});

describe("isPromptCardErrorCode", () => {
  test("hanya kode error kartu prompt", () => {
    expect(isPromptCardErrorCode("PROMPT_NOT_FOUND")).toBe(true);
    expect(isPromptCardErrorCode("PROMPT_ALREADY_RESOLVED")).toBe(true);
    expect(isPromptCardErrorCode("PROMPT_FAILED")).toBe(true);
    expect(isPromptCardErrorCode("PROMPT_EXPIRED")).toBe(false);
    expect(isPromptCardErrorCode("INTERNAL")).toBe(false);
  });
});

describe("isStreamingAssistant", () => {
  test("assistant streaming saja", () => {
    expect(isStreamingAssistant(msg("a", "assistant", [], true))).toBe(true);
    expect(isStreamingAssistant(msg("a", "assistant", []))).toBe(false);
    expect(isStreamingAssistant(msg("u", "user", [], true))).toBe(false);
  });
});

describe("hasPendingQuestionPrompt", () => {
  test("question/plan menggantikan composer, permission tidak", () => {
    expect(hasPendingQuestionPrompt([])).toBe(false);
    expect(hasPendingQuestionPrompt([prompt("p", "permission")])).toBe(false);
    expect(hasPendingQuestionPrompt([prompt("q", "question")])).toBe(true);
    expect(hasPendingQuestionPrompt([prompt("p", "permission"), prompt("x", "plan")])).toBe(true);
  });
});

describe("thoughtBlockKeys", () => {
  test("turn tanpa reasoning/tool tidak menghasilkan key", () => {
    const messages = [
      msg("u1", "user", [{ type: "text", text: "hai" }]),
      msg("a1", "assistant", [{ type: "text", id: "t1", text: "halo" }]),
    ];
    expect(thoughtBlockKeys(messages)).toEqual([]);
  });

  test("satu key per blok berlangkah, diawali id pesan pertama turn", () => {
    const messages = [
      msg("u1", "user", [{ type: "text", text: "hai" }]),
      msg("a1", "assistant", [
        { type: "reasoning", id: "r1", text: "pikir" },
        { type: "text", id: "t1", text: "jawab" },
      ]),
      msg("a2", "assistant", [{ type: "text", id: "t2", text: "lanjut" }]),
    ];
    expect(thoughtBlockKeys(messages)).toEqual(["a1:a1:r1"]);
  });
});
