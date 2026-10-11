/**
 * Selection mode daftar Session (bulk delete) — logika murni tanpa DOM,
 * dipisah agar dapat diuji `bun test` (pola `lib/session-summary.ts`).
 *
 * Pilihan disimpan sebagai `Set` id; setiap perubahan menghasilkan Set baru
 * (immutable) agar React me-render ulang.
 */

/** Tambah / buang satu id dari pilihan. */
export function toggleSelection(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * Buang id yang Session-nya sudah tidak ada (dihapus di tab/perangkat lain).
 * Mengembalikan Set yang SAMA bila tidak ada yang dibuang, agar pemanggil
 * bisa menghindari render ulang.
 */
export function pruneSelection(
  selected: ReadonlySet<string>,
  sessions: readonly { id: string }[],
): ReadonlySet<string> {
  const alive = new Set(sessions.map((s) => s.id));
  const next = new Set([...selected].filter((id) => alive.has(id)));
  return next.size === selected.size ? selected : next;
}

/** Deskripsi grup saat selection mode ("3 of 7 selected"). */
export function describeSelection(count: number, total: number): string {
  if (count === 0) return "Tap sessions to select them";
  return `${count} of ${total} selected`;
}

/** "1 session" / "3 sessions". */
export function pluralSessions(count: number): string {
  return `${count} session${count === 1 ? "" : "s"}`;
}
