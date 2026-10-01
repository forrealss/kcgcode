/**
 * Syntax highlighting blok kode — Shiki v4 (`shiki/core`, fine-grained).
 *
 * - Engine JavaScript RegExp (tanpa WASM Oniguruma): lebih ringan untuk
 *   browser; semua bahasa bawaan Shiki didukung sejak 3.9.
 * - Bahasa & tema di-import dinamis (`shiki/langs/*.mjs`,
 *   `shiki/themes/*.mjs` — subpath resmi paket `shiki`) per kebutuhan: bundle awal tidak
 *   membawa grammar apa pun; grammar dimuat saat blok kode bahasa itu
 *   pertama kali tampil, lalu di-cache (highlighter singleton).
 * - Dual theme (github-light / github-dark) sebagai CSS variable per token
 *   (`--shiki-light` / `--shiki-dark`); warna dipilih lewat kelas `.dark`
 *   aplikasi di `styles/globals.css`, jadi ganti tema tidak perlu
 *   highlight ulang.
 * - Hasilnya berupa TOKEN (bukan string HTML) yang dirender sebagai elemen
 *   React — tidak ada `dangerouslySetInnerHTML`, isi kode tetap teks.
 */
import type { HighlighterCore, TokenStyles } from "shiki/core";

/** Loader grammar per nama bahasa kanonis Shiki. */
const LANG_LOADERS = {
  javascript: () => import("shiki/langs/javascript.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  jsonc: () => import("shiki/langs/jsonc.mjs"),
  shellscript: () => import("shiki/langs/shellscript.mjs"),
  powershell: () => import("shiki/langs/powershell.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  kotlin: () => import("shiki/langs/kotlin.mjs"),
  c: () => import("shiki/langs/c.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  csharp: () => import("shiki/langs/csharp.mjs"),
  php: () => import("shiki/langs/php.mjs"),
  ruby: () => import("shiki/langs/ruby.mjs"),
  swift: () => import("shiki/langs/swift.mjs"),
  dart: () => import("shiki/langs/dart.mjs"),
  lua: () => import("shiki/langs/lua.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  graphql: () => import("shiki/langs/graphql.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  ini: () => import("shiki/langs/ini.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  scss: () => import("shiki/langs/scss.mjs"),
  vue: () => import("shiki/langs/vue.mjs"),
  svelte: () => import("shiki/langs/svelte.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  docker: () => import("shiki/langs/docker.mjs"),
  make: () => import("shiki/langs/make.mjs"),
} as const;

export type HighlightLang = keyof typeof LANG_LOADERS;

/** Alias umum di fence Markdown -> nama kanonis. */
const ALIASES: Record<string, HighlightLang> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  shell: "shellscript",
  console: "shellscript",
  ps1: "powershell",
  ps: "powershell",
  py: "python",
  golang: "go",
  rs: "rust",
  kt: "kotlin",
  "c++": "cpp",
  cs: "csharp",
  "c#": "csharp",
  rb: "ruby",
  gql: "graphql",
  yml: "yaml",
  htm: "html",
  md: "markdown",
  patch: "diff",
  dockerfile: "docker",
  makefile: "make",
  svg: "xml",
};

/**
 * Nama bahasa kanonis dari info-string fence (`ts`, `language-tsx`,
 * `JSON`), atau null bila tidak didukung (tetap tampil sebagai teks polos).
 */
export function resolveLang(raw: string | null | undefined): HighlightLang | null {
  if (!raw) return null;
  const name = raw
    .trim()
    .toLowerCase()
    .replace(/^language-/, "");
  if (name in LANG_LOADERS) return name as HighlightLang;
  return ALIASES[name] ?? null;
}

let highlighter: Promise<HighlighterCore> | null = null;
const loading = new Map<HighlightLang, Promise<void>>();

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
      import("shiki/core"),
      import("shiki/engine/javascript"),
    ]);
    return createHighlighterCore({
      themes: [import("shiki/themes/github-light.mjs"), import("shiki/themes/github-dark.mjs")],
      langs: [],
      // `forgiving`: pola grammar yang tak bisa dikonversi tidak melempar
      // error — kode tetap tampil (sebagian mungkin tak berwarna).
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    });
  })();
  return highlighter;
}

async function ensureLang(h: HighlighterCore, lang: HighlightLang): Promise<void> {
  if (h.getLoadedLanguages().includes(lang)) return;
  let p = loading.get(lang);
  if (!p) {
    p = h.loadLanguage(LANG_LOADERS[lang]()).catch((e) => {
      loading.delete(lang); // izinkan coba lagi bila import gagal (mis. offline)
      throw e;
    });
    loading.set(lang, p);
  }
  await p;
}

/** Satu token hasil highlight: teks + warna light/dark (CSS variable). */
export interface CodeToken {
  content: string;
  /** `--shiki-light` / `--shiki-dark` + gaya font (italic/bold). */
  style: Record<string, string>;
}

/**
 * Highlight kode jadi baris token. Gagal (bahasa tak dikenal / grammar
 * gagal dimuat) -> null; pemanggil menampilkan teks polos.
 */
export async function highlightCode(
  code: string,
  lang: HighlightLang,
): Promise<CodeToken[][] | null> {
  try {
    const h = await getHighlighter();
    await ensureLang(h, lang);
    const lines = h.codeToTokensWithThemes(code, {
      lang,
      themes: { light: "github-light", dark: "github-dark" },
    });
    return lines.map((line) =>
      line.map((t) => ({ content: t.content, style: tokenStyle(t.variants) })),
    );
  } catch {
    return null;
  }
}

/** Gaya satu token dari varian tema (hanya warna & font style). */
function tokenStyle(variants: Record<string, TokenStyles>) {
  const style: Record<string, string> = {};
  const light = variants.light;
  const dark = variants.dark;
  if (light?.color) style["--shiki-light"] = light.color;
  if (dark?.color) style["--shiki-dark"] = dark.color;
  // FontStyle bitmask Shiki: 1 = italic, 2 = bold, 4 = underline.
  const fs = light?.fontStyle ?? 0;
  if (fs > 0) {
    if (fs & 1) style.fontStyle = "italic";
    if (fs & 2) style.fontWeight = "600";
    if (fs & 4) style.textDecoration = "underline";
  }
  return style;
}
