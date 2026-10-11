/**
 * Navigasi Settings — bagian pengaturan dibatasi (tidak sesak), About
 * terpisah di akhir navigasi.
 */
import { expect, test } from "bun:test";
import { SETTINGS_SECTIONS } from "@/lib/routes";
import { SETTINGS_ABOUT, SETTINGS_PANELS } from "../SettingsPage";

test("empat bagian pengaturan: Devices bagian dari Security", () => {
  expect(SETTINGS_PANELS.map((p) => p.id)).toEqual(["profile", "security", "workspace", "remote"]);
});

test("About entri terpisah; navigasi mencakup semua sub-halaman", () => {
  expect(SETTINGS_ABOUT.id).toBe("about");
  expect([...SETTINGS_PANELS.map((p) => p.id), SETTINGS_ABOUT.id]).toEqual([...SETTINGS_SECTIONS]);
});
