/**
 * Preferensi tampilan per perangkat (localStorage), diatur dari
 * Settings -> Appearance.
 *
 * - Glow saat memproses (`ProcessingGlow`): glow ala Siri di dasar layar
 *   Session selama model merespon. Default MATI — efek dekoratif yang
 *   dinyalakan sendiri; hanya nilai "on" yang menyalakannya.
 *
 * Store modul + `useSyncExternalStore`: switch di Settings dan layar Session
 * selalu sinkron, termasuk antar tab (event `storage`). Storage diblokir ->
 * pilihan tetap berlaku di memori sampai halaman ditutup.
 */
import { useSyncExternalStore } from "react";

export const PROCESSING_GLOW_KEY = "kcg-code:processing-glow";

function readStored(): boolean {
  try {
    return localStorage.getItem(PROCESSING_GLOW_KEY) === "on";
  } catch {
    return false;
  }
}

let glowEnabled = readStored();
const listeners = new Set<() => void>();

function commit(next: boolean): void {
  if (next === glowEnabled) return;
  glowEnabled = next;
  for (const l of listeners) l();
}

/** Glow saat memproses dinyalakan di perangkat ini? Default: tidak. */
export function processingGlowEnabled(): boolean {
  return glowEnabled;
}

export function setProcessingGlowEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(PROCESSING_GLOW_KEY, "on");
    else localStorage.removeItem(PROCESSING_GLOW_KEY);
  } catch {
    // Storage diblokir: preferensi hanya berlaku sampai halaman ditutup.
  }
  commit(on);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

if (typeof window !== "undefined") {
  // Diubah dari tab lain (`key` null = storage dibersihkan seluruhnya).
  window.addEventListener("storage", (e) => {
    if (e.key === null || e.key === PROCESSING_GLOW_KEY) commit(readStored());
  });
}

export function useProcessingGlow(): boolean {
  return useSyncExternalStore(subscribe, processingGlowEnabled, () => false);
}
