import { describe, expect, test } from "bun:test";
import { shouldOfferUpdateDialog } from "../update-prefs";

const update = { current: "0.3.0", latest: "0.4.0", command: "bun i -g kcg-code@latest" };

describe("shouldOfferUpdateDialog", () => {
  test("versi baru yang belum pernah ditutup -> tawarkan", () => {
    expect(shouldOfferUpdateDialog(update, null, false)).toBe(true);
    // Versi lama sudah ditutup, rilis berikutnya tetap muncul.
    expect(shouldOfferUpdateDialog(update, "0.3.5", false)).toBe(true);
  });

  test("tanpa update, sudah ditutup, atau di Session view -> tidak", () => {
    expect(shouldOfferUpdateDialog(null, null, false)).toBe(false);
    expect(shouldOfferUpdateDialog(undefined, null, false)).toBe(false);
    expect(shouldOfferUpdateDialog(update, "0.4.0", false)).toBe(false);
    expect(shouldOfferUpdateDialog(update, null, true)).toBe(false);
  });
});
