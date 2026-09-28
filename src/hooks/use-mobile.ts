/**
 * Deteksi viewport di bawah breakpoint `md` (768px) untuk komponen shadcn
 * `sidebar` — di bawah ambang ini sidebar dirender sebagai Sheet (off-canvas).
 *
 * Memakai `useMediaQuery` agar render pertama langsung benar (tanpa flash
 * sidebar desktop di HP). Ambang sengaja `md`, bukan `sm` seperti
 * `useIsMobile` di `useMediaQuery.ts`, karena kelas responsif di
 * `components/ui/sidebar.tsx` memakai varian `md:`.
 */
import { useMediaQuery } from "@/hooks/useMediaQuery";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile(): boolean {
  return useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
}
