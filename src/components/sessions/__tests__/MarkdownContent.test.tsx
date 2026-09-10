/** Smoke: MarkdownContent merender GFM & membungkus tabel dengan scroll. */
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownContent } from "../MarkdownContent";

function html(md: string): string {
  return renderToStaticMarkup(<MarkdownContent>{md}</MarkdownContent>);
}

test("heading, bold, list, inline code", () => {
  const out = html("## Judul\n\n**tebal** dan `kode`\n\n- satu\n- dua");
  expect(out).toContain("<h2");
  expect(out).toContain("<strong");
  expect(out).toContain("<code");
  expect(out).toContain("<ul");
  expect(out).toContain("<li");
});

test("tabel GFM dibungkus wrapper overflow-x-auto", () => {
  const out = html("| a | b |\n|---|---|\n| 1 | 2 |");
  expect(out).toContain("<table");
  expect(out).toContain("overflow-x-auto");
  // Wrapper harus mendahului <table> (pembungkus, bukan di dalamnya).
  expect(out.indexOf("overflow-x-auto")).toBeLessThan(out.indexOf("<table"));
});

test("blok kode dapat scroll horizontal sendiri", () => {
  const out = html("```ts\nconst x = 1;\n```");
  expect(out).toContain("<pre");
  expect(out).toContain("overflow-x-auto");
});

test("HTML mentah TIDAK dirender sebagai DOM (anti-XSS)", () => {
  const out = html('Halo <img src=x onerror="alert(1)"> <script>alert(2)</script>');
  // Markup di-escape jadi teks: tidak ada tag sungguhan yang terbentuk.
  expect(out).not.toContain("<img");
  expect(out).not.toContain("<script");
  expect(out).toContain("&lt;script&gt;");
  // Atribut handler ikut ter-escape, jadi tidak pernah jadi atribut DOM.
  expect(out).not.toContain('onerror="alert(1)"');
});

test("prop internal `node` react-markdown tidak bocor jadi atribut DOM", () => {
  const out = html("## Judul\n\nteks `kode`\n\n| a |\n|---|\n| 1 |");
  expect(out).not.toContain("node=");
  expect(out).not.toContain("[object Object]");
});

test("sintaks gambar markdown tidak memicu request keluar", () => {
  const out = html("![alt](https://contoh.test/a.png)");
  expect(out).not.toContain("<img");
});

test("link buka tab baru dengan rel aman", () => {
  const out = html("[situs](https://contoh.test)");
  expect(out).toContain('target="_blank"');
  expect(out).toContain("noopener");
  expect(out).toContain("noreferrer");
});

test("strikethrough & task list (remark-gfm aktif)", () => {
  expect(html("~~coret~~")).toContain("<del");
  const tasks = html("- [x] selesai\n- [ ] belum");
  expect(tasks).toContain('type="checkbox"');
});

test("markdown setengah jadi (streaming) tidak error", () => {
  expect(() => html("```ts\nconst a = 1;")).not.toThrow();
  expect(() => html("| a | b |\n|---|")).not.toThrow();
  expect(() => html("**belum ditutup")).not.toThrow();
});

test("teks kosong aman", () => {
  expect(() => html("")).not.toThrow();
});
