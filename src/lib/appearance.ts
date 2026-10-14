/**
 * Preferensi tampilan per perangkat (localStorage), diatur dari
 * Settings -> Appearance.
 *
 * - Glow saat memproses (`ProcessingGlow`): glow ala Siri di dasar layar
 *   Session selama model merespon. Default MATI — efek dekoratif yang
 *   dinyalakan sendiri.
 * - Estimasi biaya (`showCost`): harga estimasi tiap balasan di samping
 *   jumlah token. Default MATI — angka dari agent hanya estimasi, dan bagi
 *   pengguna langganan (mis. Claude Pro/Max) tidak ditagihkan per token.
 *
 * Tiap preferensi: store modul + `useSyncExternalStore`, jadi switch di
 * Settings dan layar Session selalu sinkron, termasuk antar tab (event
 * `storage`). Hanya nilai "on" yang menyalakan; storage diblokir -> pilihan
 * tetap berlaku di memori sampai halaman ditutup.
 */
import { useSyncExternalStore } from "react";

export const PROCESSING_GLOW_KEY = "kcg-code:processing-glow";
export const SHOW_COST_KEY = "kcg-code:show-cost";

/** Preferensi boolean per perangkat (default mati). */
function booleanPref(key: string) {
  const read = (): boolean => {
    try {
      return localStorage.getItem(key) === "on";
    } catch {
      return false;
    }
  };
  let value = read();
  const listeners = new Set<() => void>();
  const commit = (next: boolean) => {
    if (next === value) return;
    value = next;
    for (const l of listeners) l();
  };
  const get = () => value;
  const set = (on: boolean) => {
    try {
      if (on) localStorage.setItem(key, "on");
      else localStorage.removeItem(key);
    } catch {
      // Storage diblokir: preferensi hanya berlaku sampai halaman ditutup.
    }
    commit(on);
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  if (typeof window !== "undefined") {
    // Diubah dari tab lain (`key` null = storage dibersihkan seluruhnya).
    window.addEventListener("storage", (e) => {
      if (e.key === null || e.key === key) commit(read());
    });
  }
  const use = () => useSyncExternalStore(subscribe, get, () => false);
  return { get, set, use };
}

const glow = booleanPref(PROCESSING_GLOW_KEY);
const showCost = booleanPref(SHOW_COST_KEY);

/** Glow saat memproses dinyalakan di perangkat ini? Default: tidak. */
export const processingGlowEnabled = glow.get;
export const setProcessingGlowEnabled = glow.set;
export const useProcessingGlow = glow.use;

/** Tampilkan estimasi biaya tiap balasan? Default: tidak. */
export const showCostEnabled = showCost.get;
export const setShowCostEnabled = showCost.set;
export const useShowCost = showCost.use;
