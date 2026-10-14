/**
 * Unit test deteksi origin sementara & iOS untuk ajakan install PWA (src/lib/pwa.ts).
 */
import { describe, expect, test } from "bun:test";
import {
  type InstallOfferEnv,
  installOfferKind,
  isEphemeralHost,
  isIOS,
  isMobileDevice,
} from "../pwa";

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

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130.0 Mobile Safari/537.36";
const DESKTOP = "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0 Safari/537.36";

describe("isMobileDevice", () => {
  test("HP & tablet, bukan desktop", () => {
    expect(isMobileDevice(IPHONE)).toBe(true);
    expect(isMobileDevice(ANDROID)).toBe(true);
    expect(isMobileDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe(true);
    expect(isMobileDevice(DESKTOP)).toBe(false);
    expect(isMobileDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe(false);
  });
});

describe("installOfferKind", () => {
  const base: InstallOfferEnv = {
    userAgent: ANDROID,
    maxTouchPoints: 5,
    hostname: "me.kcgapp.tech",
    standalone: false,
    installed: false,
    canPrompt: true,
  };

  test("Android dengan prompt browser -> tombol Install", () => {
    expect(installOfferKind(base)).toBe("prompt");
  });

  test("iPhone -> langkah Add to Home Screen", () => {
    expect(installOfferKind({ ...base, userAgent: IPHONE, canPrompt: false })).toBe("ios");
  });

  test("sudah ter-install / berjalan sebagai app -> tidak ditawarkan", () => {
    expect(installOfferKind({ ...base, standalone: true })).toBeNull();
    expect(installOfferKind({ ...base, installed: true })).toBeNull();
    expect(installOfferKind({ ...base, userAgent: IPHONE, standalone: true })).toBeNull();
  });

  test("desktop (walau jendela sempit / Chrome menawarkan install) -> tidak", () => {
    expect(installOfferKind({ ...base, userAgent: DESKTOP, maxTouchPoints: 0 })).toBeNull();
  });

  test("Android tanpa prompt (sudah ter-install atau browser lain) -> tidak", () => {
    expect(installOfferKind({ ...base, canPrompt: false })).toBeNull();
  });

  test("alamat sementara localhost.run -> tidak", () => {
    expect(installOfferKind({ ...base, hostname: "abc123.lhr.life" })).toBeNull();
    expect(
      installOfferKind({ ...base, userAgent: IPHONE, canPrompt: false, hostname: "x.lhr.life" }),
    ).toBeNull();
  });
});
