import { describe, expect, test } from "bun:test";
import { centerBlock, panel } from "../theme";

describe("centerBlock", () => {
  test("blok ditengahkan dengan padding sama — panel tidak pecah", () => {
    const out = centerBlock("abcd\nab", 10).split("\n");
    expect(out).toEqual(["   abcd", "   ab"]);
  });

  test("kode warna tidak dihitung sebagai lebar", () => {
    expect(centerBlock("\u001b[32mok\u001b[39m", 6)).toBe("  \u001b[32mok\u001b[39m");
  });

  test("tanpa lebar terminal (non-TTY) → apa adanya", () => {
    const p = panel("X", ["hello"]);
    expect(centerBlock(p, undefined)).toBe(p);
  });

  test("baris kosong tidak diberi padding; blok lebih lebar dari terminal tidak digeser", () => {
    expect(centerBlock("\nab", 6)).toBe("\n  ab");
    expect(centerBlock("abcdefgh", 4)).toBe("abcdefgh");
  });
});
