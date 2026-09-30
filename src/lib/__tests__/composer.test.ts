/**
 * Unit test placeholder composer (src/lib/composer.ts).
 */
import { describe, expect, test } from "bun:test";
import { composerPlaceholder, extractMentionedFiles, splitComposerMentions } from "../composer";

describe("composerPlaceholder", () => {
  test("ada lampiran: ajakan singkat (tidak wrap di ruang yang menyempit)", () => {
    for (const compact of [false, true]) {
      expect(
        composerPlaceholder({ busy: false, canInput: true, compact, hasAttachments: true }),
      ).toBe("Add a message…");
    }
    // Status sibuk / Session mati tetap lebih penting.
    expect(
      composerPlaceholder({ busy: true, canInput: false, compact: false, hasAttachments: true }),
    ).toBe("Model is responding…");
  });

  test("wide screen: full hint when input is ready", () => {
    expect(composerPlaceholder({ busy: false, canInput: true, compact: false })).toBe(
      "Type a message… type @ for file references, or paste an image",
    );
  });

  test("narrow screen: short text to avoid truncation", () => {
    expect(composerPlaceholder({ busy: false, canInput: true, compact: true })).toBe(
      "Type a message…",
    );
  });

  test("model responding: status outranks the typing hint", () => {
    expect(composerPlaceholder({ busy: true, canInput: false, compact: false })).toBe(
      "Model is responding…",
    );
    expect(composerPlaceholder({ busy: true, canInput: false, compact: true })).toBe("Responding…");
  });

  test("session down: same text at both sizes (already short)", () => {
    expect(composerPlaceholder({ busy: false, canInput: false, compact: false })).toBe(
      "Session is not active",
    );
    expect(composerPlaceholder({ busy: false, canInput: false, compact: true })).toBe(
      "Session is not active",
    );
  });

  test("busy is checked before canInput", () => {
    // Unusual combination (busy + canInput) still reports the responding status.
    expect(composerPlaceholder({ busy: true, canInput: true, compact: false })).toBe(
      "Model is responding…",
    );
  });
});

describe("extractMentionedFiles", () => {
  test("path yang pernah disarankan autocomplete ikut dikirim", () => {
    const known = new Set(["src/index.ts"]);
    expect(extractMentionedFiles("fix @src/index.ts", known)).toEqual(["src/index.ts"]);
  });

  test("path memuat / ikut dikirim walau tidak pernah disarankan", () => {
    expect(extractMentionedFiles("lihat @a/b/c.ts dulu", new Set())).toEqual(["a/b/c.ts"]);
  });

  test("kata biasa dengan @ (mis. @user) TIDAK dikirim tanpa slash & tak dikenal", () => {
    expect(extractMentionedFiles("halo @user apa kabar", new Set())).toEqual([]);
    // Kecuali pernah disarankan autocomplete — baru dianggap file sungguhan.
    expect(extractMentionedFiles("halo @user", new Set(["user"]))).toEqual(["user"]);
  });

  test("urutan & duplikat kemunculan dipertahankan", () => {
    const known = new Set(["a.ts"]);
    expect(extractMentionedFiles("@a.ts lalu @a.ts lagi", known)).toEqual(["a.ts", "a.ts"]);
  });

  test("tanpa teks atau tanpa @ -> kosong", () => {
    expect(extractMentionedFiles("", new Set())).toEqual([]);
    expect(extractMentionedFiles("tidak ada mention", new Set(["x.ts"]))).toEqual([]);
  });
});

describe("splitComposerMentions", () => {
  const known = new Set(["skills-lock.json"]);
  const join = (segs: { text: string }[]) => segs.map((x) => x.text).join("");

  test("memecah teks + mention yang dikenal", () => {
    const text = "lalu apa yang ada pada file @skills-lock.json ya";
    const segs = splitComposerMentions(text, known);
    expect(segs).toEqual([
      { kind: "text", text: "lalu apa yang ada pada file " },
      { kind: "mention", text: "@skills-lock.json", path: "skills-lock.json" },
      { kind: "text", text: " ya" },
    ]);
    expect(join(segs)).toBe(text);
  });

  test("path dengan / dianggap file walau belum disarankan", () => {
    const segs = splitComposerMentions("@src/App.tsx dan @src/lib/x.ts", new Set());
    expect(segs.filter((x) => x.kind === "mention").map((x) => x.text)).toEqual([
      "@src/App.tsx",
      "@src/lib/x.ts",
    ]);
  });

  test("@kata biasa & email tidak disorot", () => {
    const text = "halo @budi, email saya a@b.com";
    const segs = splitComposerMentions(text, known);
    expect(segs.every((x) => x.kind === "text")).toBe(true);
    expect(join(segs)).toBe(text);
  });

  test("gabungan potongan selalu identik dengan input", () => {
    for (const text of ["", "@", "@skills-lock.json", "\n@src/a.ts\n\nteks", "  @x/y  "]) {
      expect(join(splitComposerMentions(text, known))).toBe(text);
    }
  });
});
