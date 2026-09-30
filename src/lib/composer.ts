/**
 * Composer chat — logika murni (tanpa DOM), dipisah agar dapat diuji
 * `bun test` seperti helper `lib/` lainnya.
 *
 * Isinya keputusan teks placeholder: di layar HP input jauh lebih sempit,
 * sehingga placeholder panjang terpotong di tengah kata dan justru tidak
 * memberi informasi apa pun. Versi mobile dibuat pendek; petunjuk lengkap
 * (`@` untuk file, drop/tempel file) tetap tersedia di layar lebar.
 */

/** Kondisi composer yang menentukan teks placeholder. */
export interface ComposerPlaceholderState {
  /** Model sedang merespon (turn aktif). */
  busy: boolean;
  /** Input dapat dipakai (WS terhubung, Session running, tidak sibuk). */
  canInput: boolean;
  /** Viewport sempit — pakai teks pendek. */
  compact: boolean;
  /**
   * Ada lampiran (file) — tombol kirim muncul dan ruang teks menyempit,
   * jadi petunjuk panjang diganti ajakan singkat yang relevan.
   */
  hasAttachments?: boolean;
}

/**
 * Placeholder textarea composer. Urutan pemeriksaan penting: status sibuk
 * dan Session mati lebih informatif daripada petunjuk mengetik, jadi
 * keduanya diperiksa lebih dulu.
 */
export function composerPlaceholder(state: ComposerPlaceholderState): string {
  if (state.busy) return state.compact ? "Responding…" : "Model is responding…";
  if (!state.canInput) return "Session is not active";
  if (state.hasAttachments) return "Add a message…";
  return state.compact
    ? "Type a message…"
    : "Type a message… type @ for file references, or drop files here";
}

/**
 * Ekstrak referensi `@path` dari teks untuk dikirim sebagai part `file`
 * terpisah di prompt. Referensi dianggap file bila path-nya pernah disarankan
 * autocomplete ATAU memuat `/` (kemungkinan besar path file, bukan kata
 * biasa seperti `@user`).
 *
 * Teks asli tidak diubah — part `file` hanya penanda tambahan agar isi file
 * benar-benar dibaca opencode; urutan kemunculan & duplikat dipertahankan
 * (tiap kemunculan menjadi satu part `file`).
 */
export function extractMentionedFiles(text: string, knownPaths: ReadonlySet<string>): string[] {
  const files: string[] = [];
  for (const match of text.matchAll(/(^|\s)@([^\s]+)/g)) {
    const path = match[2] ?? "";
    if (path.length > 0 && (knownPaths.has(path) || path.includes("/"))) {
      files.push(path);
    }
  }
  return files;
}

/** Potongan teks composer untuk lapisan sorot: teks biasa atau mention file. */
export type ComposerSegment =
  | { kind: "text"; text: string }
  | { kind: "mention"; text: string; path: string };

/**
 * Pecah teks composer menjadi potongan teks biasa & mention `@path` yang
 * dikenali (aturan sama dengan `extractMentionedFiles`: path pernah
 * disarankan autocomplete ATAU memuat `/`). Gabungan `text` seluruh
 * potongan SELALU identik dengan input — lapisan sorot di belakang textarea
 * bergantung pada ini agar posisinya pas karakter demi karakter.
 */
export function splitComposerMentions(
  text: string,
  knownPaths: ReadonlySet<string>,
): ComposerSegment[] {
  const out: ComposerSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(/(^|\s)@([^\s]+)/g)) {
    const path = match[2] ?? "";
    if (path.length === 0 || !(knownPaths.has(path) || path.includes("/"))) continue;
    const start = (match.index ?? 0) + (match[1]?.length ?? 0);
    if (start > last) out.push({ kind: "text", text: text.slice(last, start) });
    out.push({ kind: "mention", text: `@${path}`, path });
    last = start + 1 + path.length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}
