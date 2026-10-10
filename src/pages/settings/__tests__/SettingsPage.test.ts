/**
 * Navigasi Settings — jumlah tab dibatasi (tidak sesak).
 */
import { expect, test } from "bun:test";
import { SETTINGS_TABS } from "../SettingsPage";

test("hanya empat tab: Devices bagian dari Security, About bukan tab", () => {
  expect(SETTINGS_TABS.map((t) => t.id)).toEqual(["profile", "security", "workspace", "remote"]);
});
