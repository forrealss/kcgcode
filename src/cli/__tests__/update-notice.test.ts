import { describe, expect, test } from "bun:test";
import { stripAnsi } from "../theme";
import { updateNotice, updateRowText } from "../update-notice";

const update = { current: "0.3.0", latest: "0.4.0", command: "bun i -g kcg-code@latest" };

describe("updateNotice", () => {
  test("versi lama -> perintah install", () => {
    expect(stripAnsi(updateNotice(update))).toBe(
      "! Update available v0.3.0 → v0.4.0 · run bun i -g kcg-code@latest",
    );
    expect(stripAnsi(updateNotice(update, "0.3.0"))).toContain("bun i -g kcg-code@latest");
    expect(stripAnsi(updateRowText(update))).toBe("v0.4.0 available · bun i -g kcg-code@latest");
  });

  test("paket sudah diperbarui, server belum -> ajakan restart", () => {
    expect(stripAnsi(updateNotice(update, "0.4.0"))).toBe(
      "! KCG Code v0.4.0 is installed — restart kcgcode to use it.",
    );
    expect(stripAnsi(updateRowText(update, "0.4.0"))).toBe("v0.4.0 installed · restart to apply");
  });
});
