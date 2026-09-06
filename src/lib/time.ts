/**
 * Format waktu & durasi untuk label UI (jam footer pesan, durasi thinking).
 * Logika murni agar mudah diuji tanpa DOM.
 */

/** Jam lokal `HH:MM:SS` untuk footer pesan. */
export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Format durasi ms ke string ringkas: "1s", "12s", "1m 5s". */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
}
