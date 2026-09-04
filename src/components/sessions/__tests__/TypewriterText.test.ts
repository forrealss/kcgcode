/**
 * Unit test `typewriterTiming` (TypewriterText.tsx).
 *
 * Logika murni: interval tick tetap, jumlah karakter per tick dihitung agar
 * seluruh teks selesai kira-kira dalam `TYPEWRITER_TARGET_MS`.
 */
import { expect, test } from "bun:test";
import { TYPEWRITER_TARGET_MS, typewriterTiming } from "../TypewriterText";

test("typewriterTiming: teks kosong aman (charsPerTick >= 1)", () => {
  const t = typewriterTiming(0);
  expect(t.charsPerTick).toBeGreaterThanOrEqual(1);
  expect(t.tickMs).toBeGreaterThan(0);
});

test("typewriterTiming: teks pendek selesai cepat (charsPerTick 1)", () => {
  const t = typewriterTiming(5);
  expect(t.charsPerTick).toBe(1);
});

test("typewriterTiming: total durasi mendekati target untuk teks panjang", () => {
  // 701 karakter (contoh jawaban panjang): durasi total ~= target, bukan molor.
  const t = typewriterTiming(701);
  const totalMs = Math.ceil(701 / t.charsPerTick) * t.tickMs;
  expect(totalMs).toBeLessThanOrEqual(TYPEWRITER_TARGET_MS + t.tickMs);
  expect(totalMs).toBeGreaterThan(TYPEWRITER_TARGET_MS * 0.5);
});

test("typewriterTiming: charsPerTick meningkat seiring panjang teks", () => {
  const short = typewriterTiming(10);
  const long = typewriterTiming(5000);
  expect(long.charsPerTick).toBeGreaterThan(short.charsPerTick);
});
