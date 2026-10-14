/**
 * Wadah melayang saran autocomplete composer (slash command, `@file`).
 *
 * Radix Popover yang di-anchor ke kotak composer (`anchorRef`, tanpa
 * membungkus JSX-nya) dan dirender lewat portal — footer composer memakai
 * `overflow-y-hidden` (perataan gutter scrollbar dengan timeline), jadi
 * dropdown `absolute` di dalamnya akan terpotong. Lebar mengikuti kotak
 * composer; tinggi dibatasi ruang yang tersedia di atasnya.
 *
 * Fokus tetap di textarea: popover tidak mengambil fokus saat terbuka, dan
 * interaksi di dalam kotak composer (mengetik, memindah kursor) tidak
 * menutupnya. Navigasi keyboard tetap milik hook autocomplete pemanggil.
 */
import type { ReactNode, RefObject } from "react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";

export interface ComposerSuggestionsProps {
  open: boolean;
  /** Kotak composer — acuan posisi & lebar. */
  anchorRef: RefObject<HTMLElement | null>;
  /** Klik di luar composer / Esc. */
  onDismiss: () => void;
  children: ReactNode;
}

export function ComposerSuggestions({
  open,
  anchorRef,
  onDismiss,
  children,
}: ComposerSuggestionsProps) {
  return (
    <Popover open={open}>
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        collisionPadding={8}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if (anchorRef.current?.contains(e.target as Node)) e.preventDefault();
          else onDismiss();
        }}
        onEscapeKeyDown={onDismiss}
        className="flex max-h-[min(20rem,var(--radix-popover-content-available-height))] w-(--radix-popover-trigger-width) flex-col overflow-hidden rounded-xl p-0"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
