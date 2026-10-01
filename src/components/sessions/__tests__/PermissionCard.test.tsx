/**
 * Kartu izin tool — render statis (Requirement 8.4, 8.5): struktur, teks,
 * dan aksesibilitas. Respon tiap tombol & pintasan keyboard diverifikasi di
 * browser sungguhan (bukan di sini — tidak ada DOM interaktif di bun test).
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { InteractivePrompt } from "@/types";
import { PromptCard } from "../PromptCard";

function permission(title: string | null, id = "per_1"): InteractivePrompt {
  return {
    id,
    sessionId: "s1",
    kind: "permission",
    type: "confirmation",
    title,
    options: null,
    status: "pending",
    createdAt: 0,
    resolvedAt: null,
  };
}

function html(prompts: InteractivePrompt[]): string {
  return renderToStaticMarkup(<PromptCard prompts={prompts} onResolve={() => {}} />);
}

describe("PermissionCard — tampilan", () => {
  test("judul = kalimat ramah; nama permission internal jadi label kecil", () => {
    const out = html([permission("external_directory — `/home/u/.config/opencode/*`")]);
    expect(out).toContain("Access a folder outside the project");
    expect(out).toContain(">external_directory</code>");
    // Teks generik lama sudah tidak dipakai.
    expect(out).not.toContain("Tool permission");
    expect(out).not.toContain("CLI_Agent");
  });

  test("target tampil tanpa backtick, satu per baris", () => {
    const out = html([permission("edit — `src/a.ts` — `src/b.ts`")]);
    expect(out).toContain(">src/a.ts</li>");
    expect(out).toContain(">src/b.ts</li>");
    expect(out).not.toContain("`src/a.ts`");
  });

  test("risiko tinggi diberi label 'Review carefully'", () => {
    expect(html([permission("bash — `rm -rf build`")])).toContain("Review carefully");
    expect(html([permission("read — `README.md`")])).toContain("Read-only");
    expect(html([permission("edit — `a.ts`")])).not.toContain("Review carefully");
  });

  test("aksi: Always allow, Deny, Allow once — tanpa Cancel duplikat", () => {
    const out = html([permission("bash — `ls`")]);
    expect(out).toContain("Always allow");
    expect(out).toContain("Deny");
    expect(out).toContain("Allow once");
    // Cancel identik dengan Deny (Req 8.5) — tidak lagi ditampilkan terpisah.
    expect(out).not.toMatch(/>Cancel</);
  });

  test("aksesibilitas: alertdialog berlabel + pintasan diumumkan", () => {
    const out = html([permission("bash — `ls`", "per_x")]);
    expect(out).toContain('role="alertdialog"');
    expect(out).toContain('aria-labelledby="perm-per_x-title"');
    expect(out).toContain('aria-keyshortcuts="Enter"');
    expect(out).toContain('aria-keyshortcuts="Escape"');
  });

  test("permission identik bertumpuk -> badge ×N", () => {
    const out = html([permission("bash — `ls`", "per_1"), permission("bash — `ls`", "per_2")]);
    expect(out).toContain("×2");
  });

  test("judul fallback / kosong -> label umum, tanpa daftar target", () => {
    const out = html([permission(null)]);
    expect(out).toContain("Use a tool");
    expect(out).not.toContain("<ul");
  });
});
