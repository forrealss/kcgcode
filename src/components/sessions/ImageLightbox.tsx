/**
 * Lightbox gambar — pratinjau layar penuh untuk lampiran (composer & pesan).
 *
 * - Dibangun di atas Radix Dialog (fokus terkunci, Esc menutup, klik latar
 *   menutup, `aria-modal`).
 * - Beberapa gambar: tombol ‹ › + panah kiri/kanan keyboard, penghitung
 *   "2 / 3", dan geser (swipe) horizontal di layar sentuh.
 * - Aksi: buka gambar asli di tab baru (hanya untuk URL non-blob — object URL
 *   lokal tidak berguna di tab lain).
 */
import { ChevronLeftIcon, ChevronRightIcon, ExternalLinkIcon, XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export interface LightboxImage {
  src: string;
  alt: string;
}

export interface ImageLightboxProps {
  images: LightboxImage[];
  /** Indeks gambar yang tampil; null = tertutup. */
  index: number | null;
  onIndexChange: (index: number | null) => void;
}

/** Jarak geser minimum (px) agar dianggap swipe. */
const SWIPE_MIN = 50;

export function ImageLightbox({ images, index, onIndexChange }: ImageLightboxProps) {
  const open = index !== null && images[index] !== undefined;
  const current = open ? images[index] : undefined;
  const many = images.length > 1;
  const touchX = useRef<number | null>(null);

  const go = (delta: number) => {
    if (index === null || !many) return;
    onIndexChange((index + delta + images.length) % images.length);
  };

  // Panah kiri/kanan untuk berpindah gambar.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `go` dibuat ulang tiap render
  useEffect(() => {
    if (!open || !many) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, many, index, images.length]);

  const canOpenOriginal = current !== undefined && !current.src.startsWith("blob:");
  const iconBtn =
    "flex size-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition-colors outline-none hover:bg-white/20 focus-visible:ring-[3px] focus-visible:ring-white/50";

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onIndexChange(null)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[110] bg-black/90 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-[110] flex flex-col outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
          onTouchStart={(e) => {
            touchX.current = e.touches[0]?.clientX ?? null;
          }}
          onTouchEnd={(e) => {
            const start = touchX.current;
            const end = e.changedTouches[0]?.clientX;
            touchX.current = null;
            if (start === null || end === undefined) return;
            if (Math.abs(end - start) >= SWIPE_MIN) go(end < start ? 1 : -1);
          }}
        >
          {/* Bar atas: nama file + penghitung, aksi di kanan. */}
          <div className="flex shrink-0 items-center gap-3 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 text-white sm:px-4">
            <DialogPrimitive.Title className="min-w-0 flex-1 truncate text-sm font-medium">
              {current?.alt ?? "Image"}
              {many && index !== null && (
                <span className="ml-2 font-normal tabular-nums text-white/60">
                  {index + 1} / {images.length}
                </span>
              )}
            </DialogPrimitive.Title>
            {canOpenOriginal && current && (
              <a
                href={current.src}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open original in new tab"
                title="Open original"
                className={iconBtn}
              >
                <ExternalLinkIcon className="size-[18px]" aria-hidden />
              </a>
            )}
            <DialogPrimitive.Close aria-label="Close preview" className={iconBtn}>
              <XIcon className="size-5" aria-hidden />
            </DialogPrimitive.Close>
          </div>

          {/* Area gambar: klik di luar gambar menutup lightbox. */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: Esc & tombol Close menangani keyboard */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: klik latar = tutup (pola lightbox) */}
          <div
            className="relative flex min-h-0 flex-1 items-center justify-center px-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-16"
            onClick={(e) => {
              if (e.target === e.currentTarget) onIndexChange(null);
            }}
          >
            {current && (
              <img
                key={current.src}
                src={current.src}
                alt={current.alt}
                className="max-h-full max-w-full rounded-lg object-contain shadow-2xl animate-in fade-in-0 zoom-in-95 duration-200 select-none"
                draggable={false}
              />
            )}

            {many && (
              <>
                <button
                  type="button"
                  onClick={() => go(-1)}
                  aria-label="Previous image"
                  className={cn(iconBtn, "absolute top-1/2 left-3 hidden -translate-y-1/2 sm:flex")}
                >
                  <ChevronLeftIcon className="size-5" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => go(1)}
                  aria-label="Next image"
                  className={cn(
                    iconBtn,
                    "absolute top-1/2 right-3 hidden -translate-y-1/2 sm:flex",
                  )}
                >
                  <ChevronRightIcon className="size-5" aria-hidden />
                </button>
              </>
            )}
          </div>

          {/* Titik posisi di HP (tombol ‹ › disembunyikan; pakai swipe). */}
          {many && index !== null && (
            <div
              className="flex shrink-0 justify-center gap-1.5 pb-[max(1rem,env(safe-area-inset-bottom))] sm:hidden"
              aria-hidden
            >
              {images.map((img, i) => (
                <span
                  key={img.src}
                  className={cn(
                    "size-1.5 rounded-full transition-colors",
                    i === index ? "bg-white" : "bg-white/30",
                  )}
                />
              ))}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
