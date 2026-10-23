/**
 * Deteksi viewport sempit (layar HP) untuk penyesuaian UI yang tidak bisa
 * dilakukan lewat CSS saja — mis. memilih teks placeholder yang lebih pendek
 * atau merender picker sebagai dialog penuh, bukan dropdown.
 *
 * Untuk perbedaan yang murni tampilan, tetap pakai varian Tailwind (`sm:`);
 * hook ini hanya untuk keputusan di level JavaScript.
 *
 * Ambang 640px mengikuti breakpoint `sm` Tailwind agar konsisten dengan
 * kelas responsif di komponen.
 */

import { useEffect, useState } from "react";

/** Ambang lebar viewport "mobile" (px) — sinkron dengan breakpoint `sm`. */
export const MOBILE_MAX_WIDTH = 639;

/** Media query default: viewport lebih sempit dari breakpoint `sm`. */
export const MOBILE_QUERY = `(max-width: ${MOBILE_MAX_WIDTH}px)`;

/**
 * `true` selama viewport cocok dengan `query`. Server-side / lingkungan tanpa
 * `matchMedia` mengembalikan `false` (asumsi layar lebar) sehingga render
 * pertama tidak pernah gagal.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    // Sinkronkan sekali: `query` bisa berubah, atau viewport sudah bergeser
    // antara render pertama dan efek ini berjalan.
    setMatches(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** Pintasan: viewport selebar HP (di bawah breakpoint `sm`). */
export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY);
}

/**
 * Media query viewport selebar breakpoint `lg` (1024px) ke atas — tata letak
 * berdampingan (panel samping inline, navigasi Settings di kiri).
 */
export const WIDE_QUERY = "(min-width: 1024px)";

/** Media query viewport di bawah breakpoint `md` (768px). */
export const BELOW_MD_QUERY = "(max-width: 767px)";

/**
 * Viewport di bawah breakpoint `md` — di bawah ambang ini sidebar shadcn
 * dirender sebagai Sheet (off-canvas). Sengaja lebih lebar dari
 * `useIsMobile` karena kelas responsif `components/ui/sidebar.tsx` memakai
 * varian `md:`.
 */
export function useIsBelowMd(): boolean {
  return useMediaQuery(BELOW_MD_QUERY);
}
