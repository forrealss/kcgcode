import { describe, expect, test } from "bun:test";
import { parseTunnelApiUrl, resolveTunnelConfig } from "../services/tunnel-config";

describe("tunnel API URL", () => {
  test("parseTunnelApiUrl normalises and rejects unsafe values", () => {
    expect(parseTunnelApiUrl(undefined)).toEqual({ ok: true, url: null });
    expect(parseTunnelApiUrl("https://rp.example.com/")).toEqual({
      ok: true,
      url: "https://rp.example.com",
    });
    expect(parseTunnelApiUrl("https://rp.example.com/base/")).toEqual({
      ok: true,
      url: "https://rp.example.com/base",
    });
    for (const bad of ["ftp://x", "not a url", "https://u:p@x.com", "https://x.com/?a=1", 42]) {
      expect(parseTunnelApiUrl(bad).ok).toBe(false);
    }
  });

  test("env wins over the baked-in URL; neither -> not configured", () => {
    expect(resolveTunnelConfig("", "")).toEqual({ apiUrl: null });
    expect(resolveTunnelConfig("", "https://baked.example.com")).toEqual({
      apiUrl: "https://baked.example.com",
    });
    expect(resolveTunnelConfig("https://env.example.com/", "https://baked.example.com")).toEqual({
      apiUrl: "https://env.example.com",
    });
    // Invalid env falls back to the baked-in value instead of breaking.
    expect(resolveTunnelConfig("ftp://nope", "https://baked.example.com")).toEqual({
      apiUrl: "https://baked.example.com",
    });
  });

  test("the repo never ships a baked-in URL (stamped only at pack time)", async () => {
    const { BUILD_TUNNEL_API_URL } = await import("../../build-config");
    expect(BUILD_TUNNEL_API_URL).toBe("");
  });
});
