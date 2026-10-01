/**
 * Lebar kolom percakapan — SATU sumber untuk timeline, composer, dan kartu
 * prompt, supaya tepi kiri-kanannya selalu sejajar.
 *
 * Kenapa bukan `max-w-3xl` (768px) di tiap tempat: timeline punya padding
 * horizontal DI DALAM kolomnya (teks mulai 16px dari tepi), sedangkan
 * composer & kartu prompt tidak — jadi dengan max-w yang sama, kotak input
 * tampak 32px lebih lebar dari teks chat. `CONVERSATION_MAX_W` adalah lebar
 * TEKS (736px = 768 - 2×16); timeline menambahkan padding-nya di luar nilai
 * ini (`TIMELINE_MAX_W`).
 */

/** Lebar isi kolom (teks chat, kotak input, kartu prompt). */
export const CONVERSATION_MAX_W = "max-w-[46rem]";

/**
 * Lebar kotak timeline = isi + padding horizontalnya (`sm:px-4` = 2×1rem),
 * sehingga TEKS timeline tepat selebar `CONVERSATION_MAX_W`.
 */
export const TIMELINE_MAX_W = "max-w-[48rem]";
