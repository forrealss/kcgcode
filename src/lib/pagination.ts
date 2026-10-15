/**
 * Pagination daftar di halaman detail Project (Sessions & Session Claude Code
 * dari luar KCG) — tiap grup dibatasi agar tidak ada yang mendominasi kolom.
 */

/** Jumlah baris per halaman tiap grup daftar Session. */
export const SESSION_PAGE_SIZE = 5;

export interface Page<T> {
  items: T[];
  /** Halaman aktif (0-based), sudah dijepit ke rentang yang valid. */
  page: number;
  pageCount: number;
  /** Nomor urut baris pertama & terakhir (1-based; 0 bila kosong). */
  from: number;
  to: number;
  total: number;
}

/** Potong `items` ke halaman `page`; halaman di luar rentang dijepit. */
export function paginate<T>(items: readonly T[], page: number, pageSize: number): Page<T> {
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(0, Math.floor(page)), pageCount - 1);
  const start = current * pageSize;
  const slice = items.slice(start, start + pageSize);
  return {
    items: slice,
    page: current,
    pageCount,
    from: total === 0 ? 0 : start + 1,
    to: start + slice.length,
    total,
  };
}
