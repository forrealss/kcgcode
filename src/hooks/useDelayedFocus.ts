/**
 * Fokus ke elemen setelah jeda singkat — menunggu animasi masuk (langkah
 * welcome screen, dialog yang baru dibuka) agar fokus tidak dicuri kembali
 * dan halaman tidak melompat di tengah animasi.
 */
import { type RefObject, useEffect } from "react";

export function useDelayedFocus(
  ref: RefObject<HTMLElement | null>,
  delayMs: number,
  {
    enabled = true,
    preventScroll = false,
  }: {
    /** `false` = jangan fokus (mis. kolom tanpa `autoFocus`). */
    enabled?: boolean;
    /** Teruskan `preventScroll` ke `focus()`. */
    preventScroll?: boolean;
  } = {},
): void {
  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(
      () => ref.current?.focus(preventScroll ? { preventScroll: true } : undefined),
      delayMs,
    );
    return () => clearTimeout(t);
  }, [ref, delayMs, enabled, preventScroll]);
}
