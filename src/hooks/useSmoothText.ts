/**
 * `useSmoothText` — haluskan teks yang tiba bertahap (streaming token model).
 *
 * Masalah: delta dari opencode datang tidak merata — kadang 2 huruf, kadang
 * satu frasa sekaligus, dengan jeda acak. Menampilkannya apa adanya terasa
 * patah-patah (teks "melompat" per potongan).
 *
 * Solusi: teks target ditampung, lalu yang TAMPIL dikejar per frame
 * (`requestAnimationFrame`) dengan laju adaptif:
 * - Laju dasar ~`BASE_CPS` karakter/detik agar ritme terasa seperti mengetik.
 * - Bila antrean menumpuk, laju naik sebanding sisa antrean: antrean
 *   menyusut eksponensial dengan konstanta waktu ~`CATCH_UP_MS` (sekitar 90%
 *   lonjakan sudah tampil dalam ~1 detik), lalu ekornya pada laju dasar.
 *   Begitu streaming selesai, sisa teks langsung tampil penuh.
 * - Potongan dibulatkan ke batas kata bila dekat, agar tidak memotong kata
 *   di tengah terlalu sering (lebih enak dibaca).
 *
 * Aturan lain:
 * - `enabled=false` (pesan selesai / riwayat): tampilkan teks penuh seketika.
 * - Teks target yang bukan kelanjutan dari yang tampil (mis. diganti
 *   snapshot berbeda) -> langsung disetel ke target, tanpa animasi mundur.
 * - Reduced motion: tanpa animasi (teks penuh seketika).
 * - Tab di latar belakang: rAF berhenti; saat kembali, sisa antrean dikejar
 *   cepat oleh laju adaptif.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** Laju dasar (karakter per detik) saat antrean kecil. */
const BASE_CPS = 90;
/** Konstanta waktu penyusutan antrean (ms) — makin kecil, makin cepat mengejar. */
const CATCH_UP_MS = 400;
/** Jarak maksimum (karakter) untuk "menempel" ke batas kata berikutnya. */
const WORD_SNAP = 12;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Hitung panjang tampilan berikutnya (murni, diuji terpisah).
 * @param shown panjang yang sedang tampil
 * @param target teks target penuh
 * @param dtMs selisih waktu sejak frame sebelumnya
 */
export function nextSmoothLength(shown: number, target: string, dtMs: number): number {
  const remaining = target.length - shown;
  if (remaining <= 0) return target.length;
  const dt = Math.max(0, Math.min(dtMs, 100)); // batasi lonjakan (tab kembali aktif)
  const adaptiveCps = (remaining / CATCH_UP_MS) * 1000;
  const cps = Math.max(BASE_CPS, adaptiveCps);
  let next = shown + Math.max(1, Math.round((cps * dt) / 1000));
  if (next >= target.length) return target.length;
  // Tempel ke akhir kata terdekat bila dekat — hindari memotong kata.
  const rest = target.slice(next, next + WORD_SNAP);
  const boundary = rest.search(/\s/);
  if (boundary > 0) next += boundary;
  return Math.min(next, target.length);
}

export function useSmoothText(target: string, enabled: boolean): string {
  const [shown, setShown] = useState(() => (enabled ? "" : target));
  const shownRef = useRef(shown);
  // Target terbaru dibaca loop tiap frame — tidak perlu memasang ulang loop
  // setiap delta tiba.
  const targetRef = useRef(target);
  targetRef.current = target;

  const commit = useCallback((value: string) => {
    if (shownRef.current === value) return;
    shownRef.current = value;
    setShown(value);
  }, []);

  /**
   * Satu loop rAF per masa streaming (`enabled`), dimiliki SATU effect dengan
   * cleanup yang membatalkannya. Sebelumnya loop dipicu per perubahan target
   * dan dijaga flag `frameRef`; di StrictMode (effect dijalankan
   * pasang -> bongkar -> pasang) flag itu tertinggal non-null setelah rAF
   * dibatalkan, sehingga loop tak pernah jalan lagi dan teks baru muncul
   * sekaligus saat streaming selesai.
   *
   * Loop berjalan selama `enabled` (hanya blok terakhir yang sedang
   * di-stream); saat sudah mengejar target, frame hanya membandingkan
   * panjang tanpa setState — murah.
   */
  useEffect(() => {
    if (!enabled || prefersReducedMotion()) return;
    // Selaraskan state dengan ref (ref bisa sudah maju saat nonaktif).
    setShown(shownRef.current);
    let frame = 0;
    let last: number | null = null;
    const tick = (ts: number) => {
      const dt = last === null ? 16 : ts - last;
      last = ts;
      const goal = targetRef.current;
      const cur = shownRef.current;
      if (!goal.startsWith(cur)) {
        // Bukan kelanjutan (teks diganti snapshot lain) -> setel langsung,
        // jangan animasi "mundur".
        commit(goal);
      } else if (cur.length < goal.length) {
        commit(goal.slice(0, nextSmoothLength(cur.length, goal, dt)));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [enabled, commit]);

  // Tidak streaming / reduced motion: teks penuh apa adanya. `shownRef`
  // ikut disinkronkan agar bila streaming berlanjut, animasi tidak mengulang
  // dari awal.
  if (!enabled || prefersReducedMotion()) {
    shownRef.current = target;
    return target;
  }
  return shown;
}
