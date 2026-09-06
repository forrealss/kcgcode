/**
 * Composer chat — logika murni (tanpa DOM), dipisah agar dapat diuji
 * `bun test` seperti helper `lib/` lainnya.
 *
 * Isinya keputusan teks placeholder: di layar HP input jauh lebih sempit,
 * sehingga placeholder panjang terpotong di tengah kata dan justru tidak
 * memberi informasi apa pun. Versi mobile dibuat pendek; petunjuk lengkap
 * (`@` untuk file, tempel gambar) tetap tersedia di layar lebar.
 */

/** Kondisi composer yang menentukan teks placeholder. */
export interface ComposerPlaceholderState {
  /** Model sedang merespon (turn aktif). */
  busy: boolean;
  /** Input dapat dipakai (WS terhubung, Session running, tidak sibuk). */
  canInput: boolean;
  /** Viewport sempit — pakai teks pendek. */
  compact: boolean;
}

/**
 * Placeholder textarea composer. Urutan pemeriksaan penting: status sibuk
 * dan Session mati lebih informatif daripada petunjuk mengetik, jadi
 * keduanya diperiksa lebih dulu.
 */
export function composerPlaceholder(state: ComposerPlaceholderState): string {
  if (state.busy) return state.compact ? "Responding…" : "Model is responding…";
  if (!state.canInput) return "Session is not active";
  return state.compact
    ? "Type a message…"
    : "Type a message… type @ for file references, or paste an image";
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
