/**
 * Helper judul Session — dipakai Client & Server agar placeholder
 * konsisten diperlakukan sebagai \"belum ada judul\".
 *
 * Seperti daftar session opencode, tiap Session harus punya judul beda.
 * Opencode meng-generate-nya via summarization setelah prompt pertama
 * (SSE `session.updated`); sementara itu KCG Code menurunkan judul lokal
 * dari teks prompt pertama agar daftar tidak penuh dengan \"New session\" / \"KCG Code Session\".
 */

export const SESSION_TITLE_PLACEHOLDERS = new Set<string>([
  "KCG Code Session",
  "KCG Code Session (resumed)",
]);

export function isPlaceholderTitle(title: string | null | undefined): boolean {
  if (title === null || title === undefined) return true;
  const t = title.trim();
  if (t === "") return true;
  return SESSION_TITLE_PLACEHOLDERS.has(t);
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

/** Judul untuk ditampilkan di daftar — placeholder difallback ke \"New session\". */
export function displaySessionTitle(title: string | null | undefined): string {
  if (isPlaceholderTitle(title ?? null)) return "New session";
  return (title as string).trim();
}
