/**
 * Unit test laju penghalusan teks streaming (`nextSmoothLength`) — logika
 * murni di balik `useSmoothText` (tanpa DOM / rAF).
 */
import { describe, expect, test } from "bun:test";
import { nextSmoothLength } from "../useSmoothText";

const FRAME = 16;

describe("nextSmoothLength", () => {
  test("selalu maju minimal satu karakter per frame", () => {
    expect(nextSmoothLength(0, "abcdef", 1)).toBeGreaterThan(0);
  });

  test("tidak melewati panjang target", () => {
    expect(nextSmoothLength(3, "abc", FRAME)).toBe(3);
    expect(nextSmoothLength(0, "ab", 1000)).toBe(2);
  });

  test("antrean kecil: laju dasar (beberapa karakter per frame)", () => {
    const text = "x".repeat(20);
    const next = nextSmoothLength(0, text, FRAME);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(6);
  });

  test("antrean besar: laju naik agar tidak tertinggal", () => {
    const text = "x".repeat(4000);
    const small = nextSmoothLength(0, "x".repeat(20), FRAME);
    const big = nextSmoothLength(0, text, FRAME);
    expect(big).toBeGreaterThan(small * 5);
  });

  test("lonjakan besar: ~90% tampil dalam ~1 detik, tuntas dalam 3 detik", () => {
    const text = "kata ".repeat(800); // 4000 karakter tiba sekaligus
    let shown = 0;
    let frames = 0;
    let at90: number | null = null;
    while (shown < text.length && frames < 1000) {
      shown = nextSmoothLength(shown, text, FRAME);
      frames++;
      if (at90 === null && shown >= text.length * 0.9) at90 = frames * FRAME;
    }
    expect(shown).toBe(text.length);
    expect(at90).not.toBeNull();
    expect(at90 ?? Number.POSITIVE_INFINITY).toBeLessThan(1200);
    expect(frames * FRAME).toBeLessThan(3000);
  });

  test("menempel ke batas kata bila dekat", () => {
    const text = "halo dunia yang indah";
    const next = nextSmoothLength(0, text, FRAME);
    // Tidak berhenti di tengah kata "halo".
    expect([" ", undefined]).toContain(text[next]);
  });

  test("lonjakan waktu (tab kembali aktif) dibatasi", () => {
    const text = "x".repeat(20);
    expect(nextSmoothLength(0, text, 10_000)).toBe(nextSmoothLength(0, text, 100));
  });
});
