import { afterEach, describe, expect, test } from "bun:test";
import { claimAnnouncement, resetAnnouncements } from "../announcements";

afterEach(resetAnnouncements);

describe("claimAnnouncement", () => {
  test("satu dialog pengumuman per pemuatan", () => {
    expect(claimAnnouncement("install")).toBe(true);
    expect(claimAnnouncement("update")).toBe(false);
    // Pemilik giliran boleh membuka lagi.
    expect(claimAnnouncement("install")).toBe(true);
  });
});
