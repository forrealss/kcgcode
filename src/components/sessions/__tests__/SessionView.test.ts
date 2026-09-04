/**
 * Unit test renderer pesan `SessionView.tsx` — bagian logika murni.
 *
 * Fokus: `textOf` — teks jawaban harus berasal dari part `text` SAJA.
 * Part `reasoning`/`tool`/`step` dari opencode juga membawa field `text`;
 * tanpa filter tipe, kalimat thinking ikut tergabung ke jawaban (regression
 * yang pernah terjadi di sesi headless).
 */
import { expect, test } from "bun:test";
import type { MessagePart, SessionMessage } from "@/types";
import {
  isLiveTextGrowth,
  shouldTypewrite,
  textOf,
  upsertMessage,
  upsertMessagePart,
} from "../SessionView";

test("textOf: hanya part text yang masuk jawaban (reasoning tidak ikut)", () => {
  const parts: MessagePart[] = [
    { type: "reasoning", text: "Saya berpikir langkah demi langkah..." },
    { type: "step-start" },
    { type: "text", text: "Jawaban: 12 * 8 = 96" },
    { type: "step-finish" },
  ];
  expect(textOf(parts)).toBe("Jawaban: 12 * 8 = 96");
});

test("textOf: beberapa part text digabung dengan newline", () => {
  const parts: MessagePart[] = [
    { type: "text", text: "baris satu" },
    { type: "reasoning", text: "rahasia" },
    { type: "text", text: "baris dua" },
  ];
  expect(textOf(parts)).toBe("baris satu\nbaris dua");
});

test("textOf: tool part dengan field text tidak ikut", () => {
  const parts: MessagePart[] = [
    { type: "tool", tool: "bash", text: "cat package.json" },
    { type: "text", text: "Selesai." },
  ];
  expect(textOf(parts)).toBe("Selesai.");
});

test("textOf: tanpa part text -> string kosong", () => {
  const parts: MessagePart[] = [
    { type: "reasoning", text: "hanya berpikir" },
    { type: "step-start" },
  ];
  expect(textOf(parts)).toBe("");
});

test("isLiveTextGrowth: kemunculan pertama (dari kosong) bukan growth", () => {
  // Part text sering dibuat kosong dulu (provider non-streaming), lalu teks
  // penuh melompat sekali — itu bukan streaming live, jadi jangan ditandai.
  expect(isLiveTextGrowth(0, 0)).toBe(false);
  expect(isLiveTextGrowth(0, 701)).toBe(false);
});

test("isLiveTextGrowth: teks bertambah bertahap -> live", () => {
  expect(isLiveTextGrowth(10, 30)).toBe(true);
  expect(isLiveTextGrowth(30, 90)).toBe(true);
  expect(isLiveTextGrowth(90, 701)).toBe(true);
});

test("isLiveTextGrowth: teks sama/berkurang bukan growth", () => {
  expect(isLiveTextGrowth(10, 10)).toBe(false);
  expect(isLiveTextGrowth(30, 10)).toBe(false);
});

test("shouldTypewrite: fallback hanya untuk pesan non-live yang baru tiba", () => {
  // Pesan final baru + teks tidak pernah ter-stream live -> typewriter.
  expect(shouldTypewrite("msg_1", new Set(["msg_1"]), new Set())).toBe(true);
  // Pesan lama (tidak ada di typingIds) -> tanpa animasi.
  expect(shouldTypewrite("msg_1", new Set(), new Set())).toBe(false);
  // Pesan yang teksnya ter-stream live bertahap -> tanpa typewriter,
  // walau id-nya ikut masuk typingIds saat pesan final tiba.
  expect(shouldTypewrite("msg_1", new Set(["msg_1"]), new Set(["msg_1"]))).toBe(false);
});

test("upsertMessagePart: pesan belum ada -> placeholder streaming", () => {
  const next = upsertMessagePart([], "s1", "msg_1", { type: "text", id: "prt_a", text: "halo" });
  expect(next).toHaveLength(1);
  expect(next[0]).toMatchObject({
    id: "msg_1",
    sessionId: "s1",
    role: "assistant",
    streaming: true,
  });
  expect(next[0]?.parts).toEqual([{ type: "text", id: "prt_a", text: "halo" }]);
});

test("upsertMessagePart: part yang sama diganti, part baru ditambahkan", () => {
  const base: SessionMessage[] = [
    {
      id: "msg_1",
      sessionId: "s1",
      role: "assistant",
      parts: [{ type: "text", id: "prt_a", text: "ha" }],
      createdAt: 1,
      streaming: true,
    },
  ];
  // Part teks bertambah (streaming) -> ganti part yang sama.
  const grown = upsertMessagePart(base, "s1", "msg_1", {
    type: "text",
    id: "prt_a",
    text: "halo dunia",
  });
  expect(grown[0]?.parts).toEqual([{ type: "text", id: "prt_a", text: "halo dunia" }]);
  expect(grown[0]?.streaming).toBe(true);

  // Part reasoning baru muncul -> ditambahkan.
  const withReason = upsertMessagePart(grown, "s1", "msg_1", {
    type: "reasoning",
    id: "prt_r",
    text: "pikir...",
  });
  expect(withReason[0]?.parts.map((p) => p.id)).toEqual(["prt_a", "prt_r"]);
});

test("upsertMessagePart: part tanpa id selalu ditambahkan", () => {
  const base: SessionMessage[] = [
    {
      id: "msg_1",
      sessionId: "s1",
      role: "assistant",
      parts: [{ type: "step-start" }],
      createdAt: 1,
    },
  ];
  const next = upsertMessagePart(base, "s1", "msg_1", { type: "text", text: "x" });
  expect(next[0]?.parts).toHaveLength(2);
});

test("upsertMessage: id sama -> replace versi streaming dengan final", () => {
  const streaming: SessionMessage = {
    id: "msg_1",
    sessionId: "s1",
    role: "assistant",
    parts: [{ type: "text", id: "prt_a", text: "parsial" }],
    createdAt: 1,
    streaming: true,
  };
  const final: SessionMessage = {
    id: "msg_1",
    sessionId: "s1",
    role: "assistant",
    parts: [{ type: "step-start" }, { type: "text", id: "prt_a", text: "lengkap" }],
    createdAt: 1,
  };
  const next = upsertMessage([streaming], final);
  expect(next).toHaveLength(1);
  expect(next[0]?.streaming).toBeUndefined();
  expect(next[0]?.parts).toHaveLength(2);
});

test("upsertMessage: id baru -> ditambahkan", () => {
  const existing: SessionMessage = {
    id: "msg_1",
    sessionId: "s1",
    role: "assistant",
    parts: [],
    createdAt: 1,
  };
  const next = upsertMessage([existing], { ...existing, id: "msg_2" });
  expect(next).toHaveLength(2);
});
