/**
 * Sinyal "data Project/Session berubah" antar bagian UI yang memuat datanya
 * sendiri (mis. homepage membuat Project -> sidebar perlu memuat ulang).
 */
const DATA_CHANGED_EVENT = "kcg-data-changed";

export function notifyDataChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
}

/** Berlangganan sinyal; mengembalikan fungsi berhenti berlangganan. */
export function onDataChanged(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(DATA_CHANGED_EVENT, listener);
  return () => window.removeEventListener(DATA_CHANGED_EVENT, listener);
}
