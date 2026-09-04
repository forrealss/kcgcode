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
  if (state.busy) return state.compact ? "Merespon…" : "Model sedang merespon…";
  if (!state.canInput) return "Session tidak aktif";
  return state.compact
    ? "Ketik pesan…"
    : "Ketik pesan… ketik @ untuk referensi file, atau tempel gambar";
}
