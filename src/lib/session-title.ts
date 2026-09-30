/**
 * Helper judul Session — dipakai Client & Server agar placeholder
 * konsisten diperlakukan sebagai "belum ada judul".
 *
 * Alur (sama seperti opencode):
 * 1. Session dibuat di opencode TANPA judul -> opencode memberi placeholder
 *    `New session - <ISO>`. Hanya judul berpola itu yang memicu opencode
 *    meng-generate judul (agent `title`, setelah langkah pertama prompt
 *    pertama), lalu dikirim lewat SSE `session.updated`.
 * 2. Sambil menunggu (biasanya beberapa detik), KCG Code menampilkan judul
 *    sementara dari baris pertama prompt (`deriveSessionTitle`).
 * 3. Judul hasil opencode selalu menggantikan judul sementara.
 *
 * `SESSION_TITLE_PLACEHOLDERS` = judul lama yang dulu dikirim KCG Code saat
 * membuat Session (opencode tidak pernah meng-generate judul untuk itu).
 */

export const SESSION_TITLE_PLACEHOLDERS = new Set<string>([
  "KCG Code Session",
  "KCG Code Session (resumed)",
]);

/**
 * Judul default opencode (`packages/opencode/src/session/session.ts`,
 * `isDefaultTitle`): `New session - ` / `Child session - ` + ISO timestamp.
 */
const OPENCODE_DEFAULT_TITLE =
  /^(New session - |Child session - )\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function isOpencodeDefaultTitle(title: string): boolean {
  return OPENCODE_DEFAULT_TITLE.test(title.trim());
}

export function isPlaceholderTitle(title: string | null | undefined): boolean {
  if (title === null || title === undefined) return true;
  const t = title.trim();
  if (t === "") return true;
  return SESSION_TITLE_PLACEHOLDERS.has(t) || isOpencodeDefaultTitle(t);
}

/**
 * Turunkan judul Session dari teks prompt pertama.
 * Ambil baris pertama, rapikan spasi, potong di batas kata dengan elipsis.
 * @returns judul siap simpan, atau null bila teks kosong.
 */
export function deriveSessionTitle(text: string, maxLength = 50): string | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const firstLine = (trimmed.split("\n")[0] ?? "").trim();
  const collapsed = firstLine.replace(/\s+/g, " ").trim();
  if (collapsed === "") return null;
  if (collapsed.length <= maxLength) return collapsed;
  const slice = collapsed.slice(0, maxLength);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > maxLength * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trim()}…`;
}

/** Judul untuk ditampilkan di daftar — placeholder difallback ke "New session". */
export function displaySessionTitle(title: string | null | undefined): string {
  if (isPlaceholderTitle(title ?? null)) return "New session";
  return (title as string).trim();
}
