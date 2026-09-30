/**
 * Pratinjau gambar yang akan dilampirkan ke pesan berikutnya, tampil DI DALAM
 * kotak composer (di atas textarea) — jelas bahwa gambar ikut pesan ini.
 *
 * - Klik thumbnail = pratinjau layar penuh (`ImageLightbox`).
 * - Tombol hapus selalu terlihat (layar sentuh tidak punya hover).
 * - Baris bisa di-scroll horizontal bila lampiran banyak.
 * Object URL dibuat & dilepas oleh pemilik state (`SessionComposer`).
 */
import { XIcon } from "lucide-react";
import { useState } from "react";
import { ImageLightbox } from "@/components/sessions/ImageLightbox";

export interface PendingImage {
  key: string;
  file: File;
  previewUrl: string;
}

export interface PendingImageThumbsProps {
  images: PendingImage[];
  onRemove: (key: string) => void;
}

export function PendingImageThumbs({ images, onRemove }: PendingImageThumbsProps) {
  const [preview, setPreview] = useState<number | null>(null);

  return (
    <>
      <ul
        aria-label={`${images.length} attached ${images.length === 1 ? "image" : "images"}`}
        className="flex gap-2 overflow-x-auto px-1 pt-1 pb-2 [scrollbar-width:thin]"
      >
        {images.map((img, i) => (
          <li key={img.key} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setPreview(i)}
              aria-label={`Preview ${img.file.name}`}
              className="block overflow-hidden rounded-lg border bg-muted outline-none transition-[box-shadow,opacity] hover:opacity-90 focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <img
                src={img.previewUrl}
                alt=""
                className="size-16 object-cover sm:size-[4.5rem]"
                draggable={false}
              />
            </button>
            <button
              type="button"
              onClick={() => onRemove(img.key)}
              aria-label={`Remove ${img.file.name}`}
              title="Remove"
              className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-black/60 text-white shadow-sm backdrop-blur-sm transition-colors outline-none hover:bg-black/80 focus-visible:ring-[3px] focus-visible:ring-white/60"
            >
              <XIcon className="size-3.5" aria-hidden />
            </button>
          </li>
        ))}
      </ul>

      <ImageLightbox
        images={images.map((img) => ({ src: img.previewUrl, alt: img.file.name }))}
        index={preview}
        onIndexChange={setPreview}
      />
    </>
  );
}
