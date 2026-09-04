/**
 * Unit test placeholder composer (src/lib/composer.ts).
 */
import { describe, expect, test } from "bun:test";
import { composerPlaceholder } from "../composer";

describe("composerPlaceholder", () => {
  test("layar lebar: petunjuk lengkap saat input siap", () => {
    expect(composerPlaceholder({ busy: false, canInput: true, compact: false })).toBe(
      "Ketik pesan… ketik @ untuk referensi file, atau tempel gambar",
    );
  });

  test("layar sempit: teks pendek agar tidak terpotong", () => {
    expect(composerPlaceholder({ busy: false, canInput: true, compact: true })).toBe(
      "Ketik pesan…",
    );
  });

  test("model merespon: status lebih penting dari petunjuk", () => {
    expect(composerPlaceholder({ busy: true, canInput: false, compact: false })).toBe(
      "Model sedang merespon…",
    );
    expect(composerPlaceholder({ busy: true, canInput: false, compact: true })).toBe("Merespon…");
  });

  test("session mati: teks sama di kedua ukuran (sudah pendek)", () => {
    expect(composerPlaceholder({ busy: false, canInput: false, compact: false })).toBe(
      "Session tidak aktif",
    );
    expect(composerPlaceholder({ busy: false, canInput: false, compact: true })).toBe(
      "Session tidak aktif",
    );
  });

  test("busy diperiksa lebih dulu daripada canInput", () => {
    // Kombinasi tak lazim (busy + canInput) tetap melaporkan status merespon.
    expect(composerPlaceholder({ busy: true, canInput: true, compact: false })).toBe(
      "Model sedang merespon…",
    );
  });
});
