/**
 * Lampiran yang akan dikirim bersama pesan berikutnya, tampil DI DALAM kotak
 * composer (di atas textarea) — jelas bahwa file ikut pesan ini.
 *
 * - Gambar: thumbnail kotak; klik = pratinjau layar penuh (`ImageLightbox`).
 * - File lain: kartu ikon + nama + jenis · ukuran.
 * - Tombol hapus selalu terlihat (layar sentuh tidak punya hover).
 * - Baris bisa di-scroll horizontal bila lampiran banyak.
 * - `hiddenKeys`: item yang sedang "mendarat" dari animasi plate drop —
 *   tetap menempati tempatnya (diukur sebagai tujuan animasi) tapi belum
 *   terlihat; `registerEl` memberi elemen tiap item ke pemanggil.
 *
 * Object URL dibuat & dilepas oleh pemilik state (`SessionComposer`).
 */
import { XIcon } from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useState } from "react";
import { FileTile } from "@/components/sessions/AttachmentTile";
import { ImageLightbox } from "@/components/sessions/ImageLightbox";
import { cn } from "@/lib/utils";

export interface PendingAttachment {
  key: string;
  file: File;
  /** Object URL pratinjau — hanya untuk gambar yang bisa dipratinjau. */
  previewUrl: string | null;
}

/** Ukuran kotak (dipakai juga oleh plate agar mendarat pas di tempatnya). */
export const IMAGE_TILE_CLASS = "size-16 sm:size-[4.5rem]";
export const FILE_TILE_CLASS = "h-16 w-48 sm:h-[4.5rem]";

/** Isi visual satu lampiran tanpa tombol (dipakai list & plate). */
export function AttachmentVisual({ item }: { item: PendingAttachment }) {
  if (item.previewUrl) {
    return (
      <span className={cn("block overflow-hidden rounded-lg border bg-muted", IMAGE_TILE_CLASS)}>
        <img src={item.previewUrl} alt="" className="size-full object-cover" draggable={false} />
      </span>
    );
  }
  return (
    <FileTile
      filename={item.file.name}
      mime={item.file.type}
      size={item.file.size}
      className={FILE_TILE_CLASS}
    />
  );
}

export interface PendingAttachmentsProps {
  items: PendingAttachment[];
  onRemove: (key: string) => void;
  hiddenKeys?: ReadonlySet<string>;
  registerEl?: (key: string, el: HTMLElement | null) => void;
}

export function PendingAttachments({
  items,
  onRemove,
  hiddenKeys,
  registerEl,
}: PendingAttachmentsProps) {
  const [preview, setPreview] = useState<number | null>(null);
  const images = items.filter((it) => it.previewUrl !== null);

  return (
    <>
      <ul
        aria-label={`${items.length} ${items.length === 1 ? "attachment" : "attachments"}`}
        className="flex gap-2 overflow-x-auto px-1 pt-1 pb-2 [scrollbar-width:thin]"
      >
        <AnimatePresence initial={false}>
          {items.map((it) => {
            const hidden = hiddenKeys?.has(it.key) ?? false;
            const imageIndex = it.previewUrl ? images.indexOf(it) : -1;
            return (
              <m.li
                key={it.key}
                ref={(el) => registerEl?.(it.key, el)}
                // Item hasil drop sudah "dianimasikan" plate — muncul tanpa
                // animasi masuk agar tidak ada kedipan saat plate berganti.
                initial={hidden ? false : { opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.15 } }}
                transition={{ type: "spring", stiffness: 500, damping: 32 }}
                className={cn("relative shrink-0", hidden && "invisible")}
              >
                {it.previewUrl ? (
                  <button
                    type="button"
                    onClick={() => setPreview(imageIndex)}
                    aria-label={`Preview ${it.file.name}`}
                    className="block rounded-lg outline-none transition-opacity hover:opacity-90 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <AttachmentVisual item={it} />
                  </button>
                ) : (
                  <span title={it.file.name} className="block">
                    <AttachmentVisual item={it} />
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onRemove(it.key)}
                  aria-label={`Remove ${it.file.name}`}
                  title="Remove"
                  className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-black/60 text-white shadow-sm backdrop-blur-sm transition-colors outline-none hover:bg-black/80 focus-visible:ring-[3px] focus-visible:ring-white/60"
                >
                  <XIcon className="size-3.5" aria-hidden />
                </button>
              </m.li>
            );
          })}
        </AnimatePresence>
      </ul>

      <ImageLightbox
        images={images.map((it) => ({ src: it.previewUrl as string, alt: it.file.name }))}
        index={preview}
        onIndexChange={setPreview}
      />
    </>
  );
}
