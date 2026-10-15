/**
 * Unit test aturan kunci aplikasi di klien (src/lib/lock-secret.ts).
 */
import { describe, expect, test } from "bun:test";
import {
  PASSWORD_MAX,
  PIN_MAX,
  sanitizeSecretInput,
  secretMaxLength,
  validateNewLock,
} from "../lock-secret";

describe("secretMaxLength", () => {
  test("PIN 12 digit, password 128 karakter", () => {
    expect(secretMaxLength("pin")).toBe(PIN_MAX);
    expect(secretMaxLength("pin")).toBe(12);
    expect(secretMaxLength("password")).toBe(PASSWORD_MAX);
    expect(secretMaxLength("password")).toBe(128);
  });
});

describe("sanitizeSecretInput", () => {
  test("PIN: buang semua selain angka", () => {
    expect(sanitizeSecretInput("pin", "12a3 4-5")).toBe("12345");
    expect(sanitizeSecretInput("pin", "abc")).toBe("");
  });

  test("password: apa adanya (spasi & simbol tetap)", () => {
    expect(sanitizeSecretInput("password", " pa55 word! ")).toBe(" pa55 word! ");
  });
});

describe("validateNewLock", () => {
  test("PIN harus 6–12 digit", () => {
    expect(validateNewLock("pin", "12345", "12345")).toBe("PIN must be 6–12 digits.");
    expect(validateNewLock("pin", "1".repeat(13), "1".repeat(13))).toBe("PIN must be 6–12 digits.");
    expect(validateNewLock("pin", "482915", "482915")).toBeNull();
    expect(validateNewLock("pin", "4".repeat(12), "4".repeat(12))).toBeNull();
  });

  test("password minimal 8 karakter", () => {
    expect(validateNewLock("password", "short", "short")).toBe(
      "Password must be at least 8 characters.",
    );
    expect(validateNewLock("password", "long enough", "long enough")).toBeNull();
  });

  test("konfirmasi harus sama; panjang dicek lebih dulu", () => {
    expect(validateNewLock("pin", "482915", "482916")).toBe("The PINs don't match.");
    expect(validateNewLock("password", "long enough", "long enougH")).toBe(
      "The passwords don't match.",
    );
    expect(validateNewLock("pin", "123", "456")).toBe("PIN must be 6–12 digits.");
  });
});
