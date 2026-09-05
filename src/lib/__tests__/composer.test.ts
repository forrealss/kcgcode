/**
 * Unit test placeholder composer (src/lib/composer.ts).
 */
import { describe, expect, test } from "bun:test";
import { composerPlaceholder } from "../composer";

describe("composerPlaceholder", () => {
  test("wide screen: full hint when input is ready", () => {
    expect(composerPlaceholder({ busy: false, canInput: true, compact: false })).toBe(
      "Type a message… type @ for file references, or paste an image",
    );
  });

  test("narrow screen: short text to avoid truncation", () => {
    expect(composerPlaceholder({ busy: false, canInput: true, compact: true })).toBe(
      "Type a message…",
    );
  });

  test("model responding: status outranks the typing hint", () => {
    expect(composerPlaceholder({ busy: true, canInput: false, compact: false })).toBe(
      "Model is responding…",
    );
    expect(composerPlaceholder({ busy: true, canInput: false, compact: true })).toBe("Responding…");
  });

  test("session down: same text at both sizes (already short)", () => {
    expect(composerPlaceholder({ busy: false, canInput: false, compact: false })).toBe(
      "Session is not active",
    );
    expect(composerPlaceholder({ busy: false, canInput: false, compact: true })).toBe(
      "Session is not active",
    );
  });

  test("busy is checked before canInput", () => {
    // Unusual combination (busy + canInput) still reports the responding status.
    expect(composerPlaceholder({ busy: true, canInput: true, compact: false })).toBe(
      "Model is responding…",
    );
  });
});
