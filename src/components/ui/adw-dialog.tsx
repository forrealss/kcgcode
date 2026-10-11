/**
 * Kerangka dialog ala AdwDialog (libadwaita) di atas `DialogContent`:
 * - Header bar: slot kiri (`start`), judul + subjudul di tengah
 *   (AdwWindowTitle), slot kanan (`end`). Tanpa `end` -> tombol tutup bundar.
 * - Tinggi dipatok (isi panjang men-scroll di dalam), sudut 2xl.
 * - Layar sempit (< sm): tampil sebagai bottom sheet dengan pegangan, seperti
 *   AdwDialog di jendela sempit; padding bawah menghormati safe-area iOS.
 * - Fokus awal: desktop -> kolom cari pertama (bila ada); HP -> dialog itu
 *   sendiri agar keyboard virtual tidak langsung muncul.
 * - Esc saat kolom cari berisi: kosongkan cari dulu (lihat `SearchEntry`),
 *   tidak menutup dialog.
 */
import { XIcon } from "lucide-react";
import { type ReactNode, useRef } from "react";
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface AdwDialogContentProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Aksi di kiri header bar (mis. "Cancel"). */
  start?: ReactNode;
  /** Aksi di kanan header bar (mis. tombol utama). Kosong -> tombol tutup. */
  end?: ReactNode;
  /** Kunci tombol tutup bawaan (mis. saat menyimpan). */
  closeDisabled?: boolean;
  /** Kelas area isi di bawah header bar. */
  bodyClassName?: string;
  children: ReactNode;
}

export function AdwDialogContent({
  title,
  subtitle,
  start,
  end,
  closeDisabled = false,
  bodyClassName,
  children,
}: AdwDialogContentProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const hasSides = start !== undefined || end !== undefined;

  return (
    <DialogContent
      ref={contentRef}
      showCloseButton={false}
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        const wide = window.matchMedia("(min-width: 640px)").matches;
        const search = contentRef.current?.querySelector<HTMLInputElement>('input[type="search"]');
        (wide && search ? search : contentRef.current)?.focus();
      }}
      onEscapeKeyDown={(e) => {
        const el = document.activeElement;
        if (el instanceof HTMLInputElement && el.type === "search" && el.value !== "") {
          e.preventDefault();
        }
      }}
      className={cn(
        "flex h-[min(640px,85dvh)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-md",
        "max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:h-[85dvh] max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0",
        "max-sm:data-[state=closed]:slide-out-to-bottom-8 max-sm:data-[state=open]:slide-in-from-bottom-8",
      )}
    >
      {/* Pegangan sheet (dekoratif) — hanya di HP. */}
      <span
        aria-hidden
        className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-muted-foreground/30 sm:hidden"
      />
      <DialogHeader
        className={cn(
          "grid shrink-0 items-center gap-2 px-3 pt-2.5 pb-2 sm:pt-3",
          // Kolom kiri/kanan selebar slot terlebar agar judul tetap di tengah.
          hasSides ? "grid-cols-[1fr_auto_1fr]" : "grid-cols-[2rem_1fr_2rem]",
        )}
      >
        <div className="flex min-w-0 justify-start">{start}</div>
        <div className="flex min-w-0 flex-col items-center gap-0.5 text-center">
          <DialogTitle className="truncate text-[15px] leading-5 font-bold">{title}</DialogTitle>
          {subtitle && (
            <DialogDescription className="truncate text-xs leading-4">{subtitle}</DialogDescription>
          )}
        </div>
        <div className="flex min-w-0 justify-end">
          {end ?? (
            <DialogClose
              disabled={closeDisabled}
              aria-label="Close"
              className="flex size-7 items-center justify-center rounded-full bg-black/[0.06] text-foreground/80 transition-colors outline-none hover:bg-black/10 focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-50 dark:bg-white/[0.08] dark:hover:bg-white/15"
            >
              <XIcon className="size-3.5" strokeWidth={2.5} />
            </DialogClose>
          )}
        </div>
      </DialogHeader>

      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-3 px-4 pt-1 pb-[max(1rem,env(safe-area-inset-bottom))]",
          bodyClassName,
        )}
      >
        {children}
      </div>
    </DialogContent>
  );
}
