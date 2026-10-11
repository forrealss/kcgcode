/**
 * Unit test selection mode daftar Session (src/lib/session-selection.ts).
 */
import { describe, expect, test } from "bun:test";
import {
  describeSelection,
  pluralSessions,
  pruneSelection,
  toggleSelection,
} from "../session-selection";

describe("toggleSelection", () => {
  test("menambah lalu membuang id tanpa memutasi input", () => {
    const empty = new Set<string>();
    const one = toggleSelection(empty, "a");
    expect([...one]).toEqual(["a"]);
    expect(empty.size).toBe(0);
    expect([...toggleSelection(one, "a")]).toEqual([]);
  });
});

describe("pruneSelection", () => {
  test("membuang id yang Session-nya sudah tidak ada", () => {
    const selected = new Set(["a", "b", "c"]);
    expect([...pruneSelection(selected, [{ id: "a" }, { id: "c" }])]).toEqual(["a", "c"]);
  });

  test("tidak ada yang dibuang -> Set yang sama (hindari render ulang)", () => {
    const selected = new Set(["a"]);
    expect(pruneSelection(selected, [{ id: "a" }, { id: "b" }])).toBe(selected);
  });
});

describe("describeSelection / pluralSessions", () => {
  test("teks ringkas", () => {
    expect(describeSelection(0, 5)).toBe("Tap sessions to select them");
    expect(describeSelection(3, 7)).toBe("3 of 7 selected");
    expect(pluralSessions(1)).toBe("1 session");
    expect(pluralSessions(4)).toBe("4 sessions");
  });
});
