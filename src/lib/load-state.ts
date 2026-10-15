/**
 * Status pemuatan data async untuk UI (memuat -> gagal / siap) — dipakai
 * bersama halaman Skills dan panel samping Project.
 */

/** Data dari API: sedang dimuat, gagal (pesan siap tampil), atau siap. */
export type Load<T> =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; data: T };

/**
 * `Load` + `idle`: belum ada yang perlu dimuat (mis. belum ada Project
 * terpilih, atau query cari terlalu pendek).
 */
export type IdleLoad<T> = { phase: "idle" } | Load<T>;
