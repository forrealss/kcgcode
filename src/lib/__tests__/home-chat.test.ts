/**
 * Unit test headline acak homepage (lib/headlines.ts) dan prompt tertunda
 * (lib/pending-prompt.ts) — logika murni.
 */
import { describe, expect, test } from "bun:test";
import { HOME_HEADLINES, pickHeadline } from "../headlines";
import {
  type PendingStore,
  peekPendingPrompt,
  setPendingPrompt,
  takePendingPrompt,
} from "../pending-prompt";

describe("pickHeadline", () => {
  test("memilih sesuai nilai random (batas bawah & atas)", () => {
    const list = ["a", "b", "c"];
    expect(pickHeadline(list, () => 0)).toBe("a");
    expect(pickHeadline(list, () => 0.5)).toBe("b");
    expect(pickHeadline(list, () => 0.9999)).toBe("c");
    // random() === 1 tidak boleh keluar dari indeks.
    expect(pickHeadline(list, () => 1)).toBe("c");
  });

  test("default memakai HOME_HEADLINES; list kosong -> string kosong", () => {
    expect(HOME_HEADLINES).toContain(pickHeadline());
    expect(pickHeadline([])).toBe("");
  });
});

function memoryStore(): PendingStore {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe("pending prompt", () => {
  test("disimpan per Session dan hanya bisa diambil sekali", () => {
    const store = memoryStore();
    setPendingPrompt("s1", "  hello  ", store);
    expect(takePendingPrompt("s2", store)).toBeNull();
    expect(takePendingPrompt("s1", store)).toBe("hello");
    expect(takePendingPrompt("s1", store)).toBeNull();
  });

  test("peek membaca tanpa menghapus", () => {
    const store = memoryStore();
    setPendingPrompt("s1", "hi", store);
    expect(peekPendingPrompt("s1", store)).toBe("hi");
    expect(peekPendingPrompt("s1", store)).toBe("hi");
    expect(takePendingPrompt("s1", store)).toBe("hi");
    expect(peekPendingPrompt("s1", store)).toBeNull();
    expect(peekPendingPrompt("s1", null)).toBeNull();
  });

  test("teks kosong tidak disimpan; tanpa storage aman", () => {
    const store = memoryStore();
    setPendingPrompt("s1", "   ", store);
    expect(takePendingPrompt("s1", store)).toBeNull();
    expect(takePendingPrompt("s1", null)).toBeNull();
  });
});
