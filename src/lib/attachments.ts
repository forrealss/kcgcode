/**
 * Jenis lampiran upload — logika murni, dipakai server (routing ke model)
 * maupun browser (thumbnail vs kartu file).
 *
 * Provider AI yang dibungkus opencode hanya menerima part `file` bermime
 * `image/*` (format umum), `application/pdf`, dan `text/plain`. Mime lain
 * (mis. `text/csv`, `application/json`) memicu error "functionality not
 * supported" dan — karena part tersimpan di riwayat — merusak seluruh turn
 * berikutnya. Karena itu:
 * - gambar umum & PDF dikirim apa adanya,
 * - file teks/kode dikirim ulang sebagai `text/plain` (opencode membacanya
 *   lewat tool Read, sama seperti `@file`),
 * - file biner lain TIDAK dikirim sebagai part; model hanya diberi tahu
 *   path-nya agar bisa memakai tool bila perlu.
 */

/** Batas ukuran upload (byte) — mengikuti limit attachment opencode (20 MiB). */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/** Gambar yang bisa dipratinjau browser & diterima provider sebagai gambar. */
const PREVIEWABLE_IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** Ekstensi file teks/kode yang aman dibaca sebagai teks. */
const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "mdx",
  "rst",
  "log",
  "csv",
  "tsv",
  "json",
  "jsonc",
  "json5",
  "ndjson",
  "yaml",
  "yml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "env",
  "xml",
  "html",
  "htm",
  "css",
  "scss",
  "sass",
  "less",
  "svg",
  "js",
  "mjs",
  "cjs",
  "jsx",
  "ts",
  "mts",
  "cts",
  "tsx",
  "vue",
  "svelte",
  "astro",
  "py",
  "rb",
  "php",
  "java",
  "kt",
  "kts",
  "scala",
  "go",
  "rs",
  "c",
  "h",
  "cc",
  "cpp",
  "hpp",
  "cs",
  "swift",
  "m",
  "dart",
  "lua",
  "pl",
  "r",
  "jl",
  "ex",
  "exs",
  "erl",
  "hs",
  "clj",
  "sql",
  "graphql",
  "gql",
  "proto",
  "sh",
  "bash",
  "zsh",
  "fish",
  "ps1",
  "bat",
  "dockerfile",
  "makefile",
  "gradle",
  "tf",
  "hcl",
  "nix",
  "lock",
  "diff",
  "patch",
  "tex",
  "bib",
  "srt",
  "vtt",
]);

/** Nama file tanpa ekstensi yang umum berisi teks. */
const TEXT_BASENAMES = new Set(["dockerfile", "makefile", "readme", "license", "gemfile"]);

export type AttachmentKind = "image" | "pdf" | "text" | "binary";

/** Ekstensi huruf kecil (tanpa titik), "" bila tidak ada. */
export function fileExtension(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

function isTextMime(mime: string): boolean {
  return (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "application/javascript" ||
    mime === "application/x-sh" ||
    mime === "application/sql" ||
    mime === "application/yaml" ||
    mime === "application/toml" ||
    mime.endsWith("+json") ||
    mime.endsWith("+xml")
  );
}

/** Gambar yang boleh ditampilkan inline di browser (thumbnail / bubble). */
export function isPreviewableImage(mime: string): boolean {
  return PREVIEWABLE_IMAGE_MIME.has(mime);
}

/**
 * Golongkan lampiran. Ekstensi dicek lebih dulu untuk file kode karena
 * browser sering salah menebak mime-nya (mis. `.ts` jadi `video/mp2t`,
 * `.rs` kosong).
 */
export function attachmentKind(mime: string, filename: string): AttachmentKind {
  const m = mime.toLowerCase();
  if (isPreviewableImage(m)) return "image";
  if (m === "application/pdf") return "pdf";
  const ext = fileExtension(filename);
  const base = (filename.split(/[\\/]/).pop() ?? "").toLowerCase();
  if (TEXT_EXTENSIONS.has(ext) || (ext === "" && TEXT_BASENAMES.has(base))) return "text";
  if (isTextMime(m)) return "text";
  return "binary";
}

/**
 * Mime part `file` yang dikirim ke model, atau null bila file tidak boleh
 * dikirim sebagai part (biner) — cukup dirujuk lewat path.
 */
export function modelFacingMime(mime: string, filename: string): string | null {
  switch (attachmentKind(mime, filename)) {
    case "image":
      return mime.toLowerCase();
    case "pdf":
      return "application/pdf";
    case "text":
      return "text/plain";
    default:
      return null;
  }
}

/**
 * Mime yang disimpan server: hanya bentuk `type/subtype` sederhana yang
 * diterima (header Content-Type tidak boleh bisa disuntik); lainnya jadi
 * `application/octet-stream`.
 */
export function normalizeMime(mime: string): string {
  const m = mime.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,127}$/.test(m)
    ? m
    : "application/octet-stream";
}

/** Ukuran file ramah baca (mis. "1.2 MB"). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}
