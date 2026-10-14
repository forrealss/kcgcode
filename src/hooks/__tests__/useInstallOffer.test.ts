import { describe, expect, test } from "bun:test";
import { INSTALL_SNOOZE_MS, isInstallSnoozed } from "../useInstallOffer";

describe("isInstallSnoozed", () => {
  test("ditunda 14 hari setelah 'Not now'", () => {
    const now = 1_000_000_000_000;
    expect(isInstallSnoozed(null, now)).toBe(false);
    expect(isInstallSnoozed(now - 1000, now)).toBe(true);
    expect(isInstallSnoozed(now - INSTALL_SNOOZE_MS + 1, now)).toBe(true);
    expect(isInstallSnoozed(now - INSTALL_SNOOZE_MS, now)).toBe(false);
  });
});
