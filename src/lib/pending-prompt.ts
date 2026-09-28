/**
 * Prompt pertama yang diketik di homepage, dititipkan sampai Session
 * barunya ter-attach di Session view (`useSessionChat`) lalu dikirim sekali.
 *
 * Disimpan di `sessionStorage` (per tab) sehingga tetap aman walau halaman
 * Session dimuat ulang sebelum koneksi WS siap; `take` menghapusnya agar
 * prompt tidak terkirim dua kali.
 */

const KEY_PREFIX = "kcg-pending-prompt:";

/** Storage minimal — diinjeksi saat test (default `sessionStorage`). */
export interface PendingStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStore(): PendingStore | null {
  return typeof sessionStorage === "undefined" ? null : sessionStorage;
}

export function setPendingPrompt(
  sessionId: string,
  text: string,
  store: PendingStore | null = defaultStore(),
): void {
  const trimmed = text.trim();
  if (store === null || trimmed === "") return;
  store.setItem(KEY_PREFIX + sessionId, trimmed);
}

/** Ambil sekaligus hapus prompt tertunda; null bila tidak ada. */
export function takePendingPrompt(
  sessionId: string,
  store: PendingStore | null = defaultStore(),
): string | null {
  if (store === null) return null;
  const key = KEY_PREFIX + sessionId;
  const value = store.getItem(key);
  if (value !== null) store.removeItem(key);
  return value !== null && value.trim() !== "" ? value : null;
}
