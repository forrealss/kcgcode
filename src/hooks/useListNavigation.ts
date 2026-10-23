/**
 * Navigasi keyboard daftar saran di composer (slash command, `@file`):
 * ↑/↓ memutar sorotan, Enter/Tab memilih, Escape menutup.
 */
import { useCallback, useState } from "react";

export interface UseListNavigationOptions {
  /** Jumlah item yang bisa dipilih. */
  count: number;
  /** Daftar sedang tampil — di luar ini tombol diteruskan ke textarea. */
  active: boolean;
  /** Pilih item ke-i; `true` bila pilihan diterapkan. */
  onSelect: (index: number) => boolean;
  onClose: () => void;
}

export interface ListNavigation {
  /** Indeks tersorot (dijepit ke rentang daftar). */
  highlighted: number;
  /** Sorotan kembali ke item pertama (mis. query / daftar berganti). */
  resetHighlight: () => void;
  /** Tangani tombol; `true` bila event ditangani (blok default). */
  handleKeyDown: (e: { key: string; preventDefault(): void }) => boolean;
}

export function useListNavigation({
  count,
  active,
  onSelect,
  onClose,
}: UseListNavigationOptions): ListNavigation {
  const [raw, setRaw] = useState(0);
  const highlighted = Math.min(raw, Math.max(0, count - 1));
  const resetHighlight = useCallback(() => setRaw(0), []);

  const handleKeyDown = useCallback(
    (e: { key: string; preventDefault(): void }): boolean => {
      if (!active) return false;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return true;
      }
      if (count === 0) return false;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setRaw((h) => (h + 1) % count);
        return true;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setRaw((h) => (h - 1 + count) % count);
        return true;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        return onSelect(highlighted);
      }
      return false;
    },
    [active, count, highlighted, onSelect, onClose],
  );

  return { highlighted, resetHighlight, handleKeyDown };
}
