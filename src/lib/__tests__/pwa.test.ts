/**
 * Unit test deteksi origin sementara & iOS untuk ajakan install PWA (src/lib/pwa.ts).
 */
import { describe, expect, test } from "bun:test";
import { isEphemeralHost, isIOS } from "../pwa";

describe("isEphemeralHost", () => {
  test("alamat localhost.run dianggap sementara", () => {
    expect(isEphemeralHost("a1b2c3d4e5f6.lhr.life")).toBe(true);
    expect(isEphemeralHost("ABC.LHR.LIFE")).toBe(true);
    expect(isEphemeralHost("foo.localhost.run")).toBe(true);
  });

  test("alamat tetap & lokal tidak dianggap sementara", () => {
    expect(isEphemeralHost("irsyad.kcgapp.tech")).toBe(false);
    expect(isEphemeralHost("localhost")).toBe(false);
    expect(isEphemeralHost("192.168.1.10")).toBe(false);
    // Bukan sufiks domain yang sebenarnya.
    expect(isEphemeralHost("notlhr.life")).toBe(false);
    expect(isEphemeralHost("lhr.life.example.com")).toBe(false);
  });
});

describe("isIOS", () => {
  test("iPhone & iPad lama", () => {
    expect(isIOS("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe(true);
    expect(isIOS("Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X)")).toBe(true);
  });

  test("iPadOS mengaku Mac: dibedakan lewat layar sentuh", () => {
    const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
    expect(isIOS(mac, 5)).toBe(true);
    expect(isIOS(mac, 0)).toBe(false);
  });

  test("Android bukan iOS", () => {
    expect(isIOS("Mozilla/5.0 (Linux; Android 14; Pixel 8)", 5)).toBe(false);
  });
});
