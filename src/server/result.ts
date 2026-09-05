/**
 * Primitif tipe server-only (pola kcgcode: tipe internal server dipisah
 * dari tipe domain FE yang hidup di `src/types/`). Tidak untuk dipakai
 * frontend.
 */

/** Hasil operasi tanpa payload (ok / gagal dengan kode error). */
export type SimpleResult = { ok: boolean; error?: string };

/**
 * Tipe hasil diskriminasi yang dipakai seluruh layer domain:
 * `{ ok: true; data } | { ok: false; error }` — bukan `throw`,
 * sesuai `design.md` — Error Handling.
 */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };
