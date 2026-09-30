/**
 * Unit test penerapan delta streaming di sisi Client (`appendMessagePartDelta`)
 * — logika murni, meniru urutan event opencode 1.x: part dibuat dengan teks
 * kosong (`message_part`), lalu teks bertambah lewat `message_part_delta`.
 */
import { describe, expect, test } from "bun:test";
import type { SessionMessage } from "@/types";
import { appendMessagePartDelta, upsertMessagePart } from "../turns";

function base(): SessionMessage[] {
  return upsertMessagePart([], "s1", "msg_a1", { type: "text", id: "prt_t1", text: "" });
}

describe("appendMessagePartDelta", () => {
  test("menambahkan delta berurutan ke field part", () => {
    let msgs = base();
    for (const d of ["Ku", "cing ", "lucu."]) {
      msgs = appendMessagePartDelta(msgs, "msg_a1", "prt_t1", "text", d);
    }
    expect(msgs[0]?.parts[0]?.text).toBe("Kucing lucu.");
    expect(msgs[0]?.streaming).toBe(true);
  });

  test("field belum ada diperlakukan sebagai string kosong", () => {
    const msgs = upsertMessagePart([], "s1", "msg_a1", { type: "reasoning", id: "prt_r1" });
    const next = appendMessagePartDelta(msgs, "msg_a1", "prt_r1", "text", "pikir");
    expect(next[0]?.parts[0]?.text).toBe("pikir");
  });

  test("pesan/part tak dikenal atau delta kosong -> array yang sama", () => {
    const msgs = base();
    expect(appendMessagePartDelta(msgs, "msg_x", "prt_t1", "text", "a")).toBe(msgs);
    expect(appendMessagePartDelta(msgs, "msg_a1", "prt_x", "text", "a")).toBe(msgs);
    expect(appendMessagePartDelta(msgs, "msg_a1", "prt_t1", "text", "")).toBe(msgs);
  });

  test("tidak memutasi state sebelumnya", () => {
    const msgs = base();
    const before = JSON.stringify(msgs);
    appendMessagePartDelta(msgs, "msg_a1", "prt_t1", "text", "hai");
    expect(JSON.stringify(msgs)).toBe(before);
  });

  test("snapshot final (message_part) menggantikan hasil akumulasi", () => {
    let msgs = base();
    msgs = appendMessagePartDelta(msgs, "msg_a1", "prt_t1", "text", "Kuc");
    msgs = upsertMessagePart(msgs, "s1", "msg_a1", {
      type: "text",
      id: "prt_t1",
      text: "Kucing lucu.",
    });
    expect(msgs[0]?.parts).toHaveLength(1);
    expect(msgs[0]?.parts[0]?.text).toBe("Kucing lucu.");
  });
});
