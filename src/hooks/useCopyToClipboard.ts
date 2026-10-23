/**
 * Salin teks ke clipboard + flag `copied` yang kembali `false` setelah
 * `resetMs` (ikon centang sementara). Timer dibersihkan saat unmount atau
 * saat menyalin lagi sebelum reset.
 *
 * Clipboard API butuh konteks aman (HTTPS / localhost) — tanpa itu
 * `copy()` mengembalikan `false` dan pemanggil memilih tampilkan toast
 * atau diam.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface CopyToClipboard {
  copied: boolean;
  /** `true` bila berhasil disalin. */
  copy: (text: string) => Promise<boolean>;
}

export function useCopyToClipboard(resetMs = 1500): CopyToClipboard {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        return false;
      }
      if (timer.current) clearTimeout(timer.current);
      setCopied(true);
      timer.current = setTimeout(() => {
        timer.current = null;
        setCopied(false);
      }, resetMs);
      return true;
    },
    [resetMs],
  );

  return { copied, copy };
}
