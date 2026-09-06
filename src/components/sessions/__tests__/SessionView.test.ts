/**
 * Unit test renderer pesan `SessionView.tsx` — bagian logika murni.
 *
 * Fokus: `textOf` — teks jawaban harus berasal dari part `text` SAJA.
 * Part `reasoning`/`tool`/`step` dari opencode juga membawa field `text`;
 * tanpa filter tipe, kalimat thinking ikut tergabung ke jawaban (regression
 * yang pernah terjadi di sesi headless).
 */
import { expect, test } from "bun:test";
import {
  groupTurns,
  hasVisibleContent,
  textOf,
  toolLabel,
  turnSegments,
  turnStatus,
  upsertMessage,
  upsertMessagePart,
} from "@/lib/turns";
import type { MessagePart, SessionMessage } from "@/types";

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

test("groupTurns: assistant berdempetan (satu turn) menjadi satu grup", () => {
  const messages: SessionMessage[] = [
    { id: "u1", sessionId: "s1", role: "user", parts: [], createdAt: 1 },
    {
      id: "a1",
      sessionId: "s1",
      role: "assistant",
      parts: [{ type: "reasoning", text: "pikir" }],
      createdAt: 2,
    },
    {
      id: "a2",
      sessionId: "s1",
      role: "assistant",
      parts: [{ type: "tool", tool: "read" }],
      createdAt: 3,
    },
    {
      id: "a3",
      sessionId: "s1",
      role: "assistant",
      parts: [{ type: "text", text: "jawaban" }],
      createdAt: 4,
    },
  ];
  const groups = groupTurns(messages);
  expect(groups).toHaveLength(2);
  expect(groups[0]).toMatchObject({ kind: "user" });
  expect(groups[1]).toMatchObject({ kind: "assistant", id: "a1" });
  if (groups[1]?.kind === "assistant") {
    expect(groups[1].messages.map((m) => m.id)).toEqual(["a1", "a2", "a3"]);
  }
});

test("groupTurns: user memisahkan dua turn assistant", () => {
  const mk = (id: string, role: "user" | "assistant"): SessionMessage => ({
    id,
    sessionId: "s1",
    role,
    parts: [],
    createdAt: 1,
  });
  const groups = groupTurns([mk("a1", "assistant"), mk("u1", "user"), mk("a2", "assistant")]);
  expect(groups).toHaveLength(3);
  expect(groups[0]).toMatchObject({ kind: "assistant", id: "a1" });
  expect(groups[1]).toMatchObject({ kind: "user" });
  expect(groups[2]).toMatchObject({ kind: "assistant", id: "a2" });
});

test("turnSegments: reasoning tampil terpisah sesuai urutan (ala terminal)", () => {
  const messages: SessionMessage[] = [
    {
      id: "a1",
      sessionId: "s1",
      role: "assistant",
      parts: [
        { type: "reasoning", id: "r1", text: "pikir pertama" },
        { type: "tool", id: "t1", tool: "read" },
        { type: "reasoning", id: "r2", text: "pikir kedua" },
        { type: "text", id: "x1", text: "jawaban" },
      ],
      createdAt: 1,
    },
  ];
  const segs = turnSegments(messages);
  expect(segs.map((s) => s.kind)).toEqual(["reasoning", "tool", "reasoning", "text"]);
  expect(segs[0]).toMatchObject({ kind: "reasoning", key: "a1:r1" });
  expect(segs[2]).toMatchObject({ kind: "reasoning", key: "a1:r2" });
  // Segmen teks terakhir = jawaban final.
  expect(segs[3]).toMatchObject({ kind: "text", final: true, text: "jawaban" });
});

test("turnSegments: antar pesan dalam satu turn tetap berurutan", () => {
  const messages: SessionMessage[] = [
    {
      id: "a1",
      sessionId: "s1",
      role: "assistant",
      parts: [{ type: "reasoning", id: "r1", text: "pikir A" }],
      createdAt: 1,
    },
    {
      id: "a2",
      sessionId: "s1",
      role: "assistant",
      parts: [
        { type: "tool", id: "t1", tool: "bash" },
        { type: "reasoning", id: "r2", text: "pikir B" },
        { type: "text", id: "x1", text: "jawaban" },
      ],
      createdAt: 2,
    },
  ];
  const segs = turnSegments(messages);
  expect(segs.map((s) => s.kind)).toEqual(["reasoning", "tool", "reasoning", "text"]);
  expect(segs.map((s) => s.key)).toEqual(["a1:r1", "a2:t1", "a2:r2", "a2:x1"]);
});

test("turnSegments: part text berdempetan digabung; teks interim bukan final", () => {
  const messages: SessionMessage[] = [
    {
      id: "a1",
      sessionId: "s1",
      role: "assistant",
      parts: [
        { type: "text", id: "x1", text: "progres..." },
        { type: "tool", id: "t1", tool: "read" },
        { type: "text", id: "x2", text: "jawaban" },
        { type: "text", id: "x3", text: "lanjutan" },
      ],
      createdAt: 1,
    },
  ];
  const segs = turnSegments(messages);
  expect(segs.map((s) => s.kind)).toEqual(["text", "tool", "text"]);
  expect(segs[0]).toMatchObject({ kind: "text", final: false, text: "progres..." });
  expect(segs[2]).toMatchObject({ kind: "text", final: true, text: "jawaban\nlanjutan" });
});

test("turnSegments: step & part lain dilewati, error jadi segmen sendiri", () => {
  const messages: SessionMessage[] = [
    {
      id: "a1",
      sessionId: "s1",
      role: "assistant",
      parts: [
        { type: "step-start" },
        { type: "error", id: "e1", text: "gagal" },
        { type: "step-finish" },
      ],
      createdAt: 1,
    },
  ];
  const segs = turnSegments(messages);
  expect(segs).toHaveLength(1);
  expect(segs[0]).toMatchObject({ kind: "error", key: "a1:e1" });
});

test("toolLabel: part tool dengan state.input.filePath -> nama + target", () => {
  const part: MessagePart = {
    type: "tool",
    tool: "read",
    state: { input: { filePath: "src/index.ts" } },
  };
  expect(toolLabel(part)).toBe("read src/index.ts");
});

test("toolLabel: fallback key path/command/pattern", () => {
  expect(toolLabel({ type: "tool", tool: "bash", state: { input: { command: "bun test" } } })).toBe(
    "bash bun test",
  );
  expect(toolLabel({ type: "tool", tool: "glob", state: { input: { pattern: "**/*.ts" } } })).toBe(
    "glob **/*.ts",
  );
});

test("toolLabel: part file (echo @file) memakai filename", () => {
  expect(toolLabel({ type: "file", mime: "text/plain", filename: "package.json" })).toBe(
    "file package.json",
  );
});

test("toolLabel: tanpa target -> nama tool saja", () => {
  expect(toolLabel({ type: "tool", tool: "read" })).toBe("read");
  // tool kosong -> fallback ke tipe part.
  expect(toolLabel({ type: "tool" })).toBe("tool");
});

test("hasVisibleContent: reasoning/tool/error/teks dianggap konten", () => {
  const mk = (parts: MessagePart[]): SessionMessage[] => [
    { id: "a1", sessionId: "s1", role: "assistant", parts, createdAt: 1 },
  ];
  expect(hasVisibleContent(turnSegments(mk([{ type: "reasoning", text: "pikir" }])))).toBe(true);
  expect(hasVisibleContent(turnSegments(mk([{ type: "tool", tool: "read" }])))).toBe(true);
  expect(hasVisibleContent(turnSegments(mk([{ type: "error", text: "gagal" }])))).toBe(true);
  expect(hasVisibleContent(turnSegments(mk([{ type: "text", text: "jawaban" }])))).toBe(true);
});

test("hasVisibleContent: step & part kosong bukan konten (indikator tetap tampil)", () => {
  const mk = (parts: MessagePart[]): SessionMessage[] => [
    { id: "a1", sessionId: "s1", role: "assistant", parts, createdAt: 1 },
  ];
  expect(hasVisibleContent(turnSegments(mk([{ type: "step-start" }])))).toBe(false);
  expect(hasVisibleContent(turnSegments(mk([{ type: "text", text: "" }])))).toBe(false);
  expect(hasVisibleContent(turnSegments(mk([{ type: "reasoning", text: "  " }])))).toBe(false);
  expect(hasVisibleContent(turnSegments(mk([])))).toBe(false);
});

test("turnStatus: full cycle Working -> Thinking -> tool -> Writing -> null", () => {
  const mk = (parts: MessagePart[]): SessionMessage[] => [
    { id: "a1", sessionId: "s1", role: "assistant", parts, createdAt: 1 },
  ];
  // Belum ada konten apa pun.
  expect(turnStatus(mk([{ type: "step-start" }]), true)).toBe("Working…");
  // Reasoning terakhir masih berjalan.
  expect(turnStatus(mk([{ type: "reasoning", text: "pikir" }]), true)).toBe("Thinking…");
  // Tool call terakhir: label tool + target.
  expect(
    turnStatus(
      mk([
        { type: "reasoning", text: "pikir" },
        { type: "tool", tool: "read", state: { input: { filePath: "package.json" } } },
      ]),
      true,
    ),
  ).toBe("read package.json");
  // Teks mulai diketik (belum final).
  expect(
    turnStatus(
      mk([
        { type: "reasoning", text: "pikir" },
        { type: "text", text: "jawaban" },
      ]),
      true,
    ),
  ).toBe("Writing…");
  // Turn selesai -> maskot disembunyikan.
  expect(turnStatus(mk([{ type: "text", text: "jawaban" }]), false)).toBeNull();
  // Tidak ada pesan sama sekali.
  expect(turnStatus([], true)).toBeNull();
});

test("turnStatus: akhir turn ditandai streaming=false (pesan final menggantikan)", () => {
  const mk = (parts: MessagePart[]): SessionMessage[] => [
    { id: "a1", sessionId: "s1", role: "assistant", parts, createdAt: 1 },
  ];
  // Segmen teks terakhir ditandai final...
  const segs = turnSegments(mk([{ type: "text", text: "jawaban" }]));
  expect(segs[0]).toMatchObject({ final: true });
  // ...tapi penanda selesai turn adalah streaming=false: pesan final selalu
  // menggantikan versi streaming, sehingga kontraknya sederhana.
  expect(turnStatus(mk([{ type: "text", text: "jawaban" }]), true)).toBe("Writing…");
  expect(turnStatus(mk([{ type: "text", text: "jawaban" }]), false)).toBeNull();
});

test("turnStatus: error menghentikan proses -> null", () => {
  const mk = (parts: MessagePart[]): SessionMessage[] => [
    { id: "a1", sessionId: "s1", role: "assistant", parts, createdAt: 1 },
  ];
  expect(turnStatus(mk([{ type: "error", text: "gagal" }]), true)).toBeNull();
});
