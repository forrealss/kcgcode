/**
 * Unit test helper judul Session (src/lib/session-title.ts).
 */
import { describe, expect, test } from "bun:test";
import {
  deriveSessionTitle,
  displaySessionTitle,
  isOpencodeDefaultTitle,
  isPlaceholderTitle,
} from "../session-title";

describe("isOpencodeDefaultTitle", () => {
  test("pola default opencode (parent & child) dikenali", () => {
    expect(isOpencodeDefaultTitle("New session - 2026-09-29T10:59:18.048Z")).toBe(true);
    expect(isOpencodeDefaultTitle("Child session - 2026-09-29T10:59:18.048Z")).toBe(true);
  });

  test("judul nyata / pola mirip tidak dianggap default", () => {
    expect(isOpencodeDefaultTitle("Cara Kerja Rate Limiting di Express")).toBe(false);
    expect(isOpencodeDefaultTitle("New session")).toBe(false);
    expect(isOpencodeDefaultTitle("New session - kemarin")).toBe(false);
    expect(isOpencodeDefaultTitle("New session - 2026-09-29")).toBe(false);
  });
});

describe("isPlaceholderTitle", () => {
  test("null, kosong, placeholder lama KCG Code, dan default opencode", () => {
    expect(isPlaceholderTitle(null)).toBe(true);
    expect(isPlaceholderTitle(undefined)).toBe(true);
    expect(isPlaceholderTitle("   ")).toBe(true);
    expect(isPlaceholderTitle("KCG Code Session")).toBe(true);
    expect(isPlaceholderTitle("KCG Code Session (resumed)")).toBe(true);
    expect(isPlaceholderTitle("New session - 2026-09-29T10:59:18.048Z")).toBe(true);
    expect(isPlaceholderTitle("Refactor auth module")).toBe(false);
  });
});

describe("displaySessionTitle", () => {
  test("placeholder -> 'New session'; judul nyata dirapikan", () => {
    expect(displaySessionTitle("New session - 2026-09-29T10:59:18.048Z")).toBe("New session");
    expect(displaySessionTitle(null)).toBe("New session");
    expect(displaySessionTitle("  Rate limiting  ")).toBe("Rate limiting");
  });
});

describe("deriveSessionTitle", () => {
  test("baris pertama, spasi dirapatkan, dipotong di batas kata", () => {
    expect(deriveSessionTitle("  halo,   project apa ini?\nbaris dua")).toBe(
      "halo, project apa ini?",
    );
    expect(deriveSessionTitle("")).toBeNull();
    const long = deriveSessionTitle(
      "tolong jelaskan cara kerja rate limiting di express dan nestjs",
    );
    expect(long?.endsWith("…")).toBe(true);
    expect((long ?? "").length).toBeLessThanOrEqual(51);
  });
});
