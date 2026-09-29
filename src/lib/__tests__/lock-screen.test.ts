/**
 * Unit test logika keyboard lock screen (src/lib/lock-screen.ts).
 */
import { describe, expect, test } from "bun:test";
import { applyPinAction, digitsFromPaste, PIN_MAX, pinKeyAction } from "../lock-screen";

describe("pinKeyAction", () => {
  test("angka baris atas & numpad -> digit", () => {
    for (const k of ["0", "5", "9"]) {
      expect(pinKeyAction({ key: k })).toEqual({ type: "digit", digit: k });
    }
  });

  test("numpad dibaca dari code, termasuk saat NumLock mati", () => {
    expect(pinKeyAction({ key: "4", code: "Numpad4" })).toEqual({ type: "digit", digit: "4" });
    expect(pinKeyAction({ key: "ArrowLeft", code: "Numpad4" })).toEqual({
      type: "digit",
      digit: "4",
    });
    expect(pinKeyAction({ key: "Insert", code: "Numpad0" })).toEqual({ type: "digit", digit: "0" });
    expect(pinKeyAction({ key: "Enter", code: "NumpadEnter" })).toEqual({ type: "submit" });
    // Panah biasa (bukan numpad) tetap diabaikan.
    expect(pinKeyAction({ key: "ArrowLeft", code: "ArrowLeft" })).toBeNull();
  });

  test("Backspace/Delete, Enter, Escape", () => {
    expect(pinKeyAction({ key: "Backspace" })).toEqual({ type: "backspace" });
    expect(pinKeyAction({ key: "Delete" })).toEqual({ type: "backspace" });
    expect(pinKeyAction({ key: "Enter" })).toEqual({ type: "submit" });
    expect(pinKeyAction({ key: "Escape" })).toEqual({ type: "clear" });
  });

  test("huruf & pintasan browser diabaikan", () => {
    expect(pinKeyAction({ key: "a" })).toBeNull();
    expect(pinKeyAction({ key: "Tab" })).toBeNull();
    expect(pinKeyAction({ key: "5", ctrlKey: true })).toBeNull();
    expect(pinKeyAction({ key: "r", metaKey: true })).toBeNull();
    expect(pinKeyAction({ key: "1", altKey: true })).toBeNull();
  });
});

describe("applyPinAction", () => {
  test("tambah, hapus, kosongkan; submit tidak mengubah", () => {
    expect(applyPinAction("12", { type: "digit", digit: "3" })).toBe("123");
    expect(applyPinAction("123", { type: "backspace" })).toBe("12");
    expect(applyPinAction("", { type: "backspace" })).toBe("");
    expect(applyPinAction("123", { type: "clear" })).toBe("");
    expect(applyPinAction("123", { type: "submit" })).toBe("123");
  });

  test("tidak melebihi PIN_MAX", () => {
    const full = "4".repeat(PIN_MAX);
    expect(applyPinAction(full, { type: "digit", digit: "1" })).toBe(full);
  });
});

describe("digitsFromPaste", () => {
  test("ambil angka saja, digabung, dipotong PIN_MAX", () => {
    expect(digitsFromPaste("48 29-15", "")).toBe("482915");
    expect(digitsFromPaste("15", "4829")).toBe("482915");
    expect(digitsFromPaste("1".repeat(20), "")).toBe("1".repeat(PIN_MAX));
    expect(digitsFromPaste("abc", "12")).toBe("12");
  });
});
