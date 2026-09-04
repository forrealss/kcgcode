/**
 * Unit test logika murni referensi `@file` (src/hooks/useMention.ts).
 *
 * `bun test` tidak menyediakan DOM, sehingga yang diuji adalah
 * `activeMention()` (deteksi token @query pada posisi kursor) dan
 * `applyMention()` (substitusi token saat saran dipilih) — pola yang sama
 * dengan test `useTheme.ts` / `useRouter.ts`.
 */
import { describe, expect, test } from "bun:test";
import { activeMention, applyMention } from "../useMention";

describe("activeMention", () => {
  test("token @ aktif di akhir input", () => {
    expect(activeMention("lihat @", 7)).toEqual({ query: "", start: 6, end: 7 });
    expect(activeMention("lihat @sr", 9)).toEqual({ query: "sr", start: 6, end: 9 });
  });

  test("kursor di tengah token", () => {
    // caret 6 pada "@src/app" -> token "@src/a"
    expect(activeMention("@src/app", 6)).toEqual({ query: "src/a", start: 0, end: 6 });
    // caret 8 -> token "@src/app"
    expect(activeMention("@src/app", 8)).toEqual({ query: "src/app", start: 0, end: 8 });
  });

  test("bukan mention: tanpa @, @ tertutup spasi, atau kursor setelah spasi", () => {
    expect(activeMention("halo", 4)).toBeNull();
    expect(activeMention("@src done", 9)).toBeNull(); // spasi menutup token
    expect(activeMention("a @ b", 5)).toBeNull();
  });

  test("@ yang menempel kata lain (email) bukan mention", () => {
    expect(activeMention("user@mail", 9)).toBeNull();
  });

  test("spasi di dalam path menghentikan token", () => {
    // kursor tepat sebelum spasi masih aktif
    expect(activeMention("@src/ app", 5)).toEqual({ query: "src/", start: 0, end: 5 });
    // setelah spasi -> tidak aktif
    expect(activeMention("@src/ app", 9)).toBeNull();
  });

  test("properti — kursor di luar rentang wajar", () => {
    expect(activeMention("abc", -1)).toBeNull();
    expect(activeMention("abc", 10)).toBeNull();
  });
});

describe("applyMention", () => {
  test("mengganti token @query dengan @path di posisi tepat", () => {
    const range = activeMention("lihat @sr", 9);
    if (!range) throw new Error("range null");
    expect(applyMention("lihat @sr", range, "src/App.tsx")).toBe("lihat @src/App.tsx");
  });

  test("menambah spasi penutup bila karakter berikut non-pemisah", () => {
    // range.end = 8 tepat sebelum spasi? tidak — pakai teks tanpa spasi:
    const t2 = "@src/app";
    const range2 = activeMention(t2, 8);
    if (!range2) throw new Error("range null");
    expect(applyMention(t2, range2, "src/app.tsx")).toBe("@src/app.tsx");
    // Suffix spasi terjadi bila token disusul karakter non-pemisah:
    // "@sr|c x" (kursor di |, end=3) -> ganti "@sr" -> "@s/x.ts" + " c x".
    const range = { query: "sr", start: 0, end: 3 };
    expect(applyMention("@src x", range, "s/x.ts")).toBe("@s/x.ts c x");
  });

  test("tanpa spasi ekstra bila di akhir teks", () => {
    const range = activeMention("@a", 2);
    if (!range) throw new Error("range null");
    expect(applyMention("@a", range, "a.ts")).toBe("@a.ts");
  });

  test("sisa teks setelah token tetap utuh", () => {
    const text = "@sr dan sisa";
    const range = activeMention(text, 3);
    if (!range) throw new Error("range null");
    expect(applyMention(text, range, "src/x.ts")).toBe("@src/x.ts dan sisa");
  });
});
