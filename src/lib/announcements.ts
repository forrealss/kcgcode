/**
 * Dialog pengumuman yang muncul sendiri (pasang app, versi baru): paling
 * banyak SATU per pemuatan app, agar pengguna tidak disodori dialog
 * beruntun. Yang tidak kebagian giliran belum ditandai "sudah dilihat",
 * jadi tampil di pemuatan berikutnya.
 */
let owner: string | null = null;

/** Ambil giliran tampil; false bila dialog pengumuman lain sudah tampil. */
export function claimAnnouncement(id: string): boolean {
  if (owner !== null && owner !== id) return false;
  owner = id;
  return true;
}

/** Hanya untuk test. */
export function resetAnnouncements(): void {
  owner = null;
}
