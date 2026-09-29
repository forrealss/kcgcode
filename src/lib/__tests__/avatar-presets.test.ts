/**
 * Katalog avatar bawaan: setiap id preset (dipakai server) wajib punya
 * pemetaan ikon di FE, dan sebaliknya.
 */
import { describe, expect, test } from "bun:test";
import { AVATAR_PRESETS } from "@/components/auth/avatar-icons";
import { AVATAR_PRESET_IDS, isAvatarPresetId } from "../avatar-presets";

describe("avatar presets", () => {
  test("id server == pemetaan ikon FE", () => {
    expect(Object.keys(AVATAR_PRESETS).sort()).toEqual([...AVATAR_PRESET_IDS].sort());
    for (const id of AVATAR_PRESET_IDS) {
      expect(typeof AVATAR_PRESETS[id].Icon).toBe("object");
      expect(AVATAR_PRESETS[id].label.length).toBeGreaterThan(0);
    }
  });

  test("isAvatarPresetId hanya menerima id katalog", () => {
    expect(isAvatarPresetId("cat")).toBe(true);
    expect(isAvatarPresetId("Cat")).toBe(false);
    expect(isAvatarPresetId("../x")).toBe(false);
    expect(isAvatarPresetId(1)).toBe(false);
    expect(new Set(AVATAR_PRESET_IDS).size).toBe(AVATAR_PRESET_IDS.length);
  });
});
