/**
 * Pratinjau gambar yang akan dilampirkan ke pesan berikutnya (bisa dihapus
 * sebelum kirim). Object URL dibuat & dilepas oleh pemilik state.
 */
import { XIcon } from "lucide-react";

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
  return (
    <div className="mx-auto mt-2 flex w-full max-w-3xl flex-wrap gap-1.5">
      {images.map((img) => (
        <div key={img.key} className="group relative">
          <img
            src={img.previewUrl}
            alt={img.file.name}
            className="h-16 w-16 rounded-md border object-cover"
          />
          <button
            type="button"
            onClick={() => onRemove(img.key)}
            aria-label={`Remove ${img.file.name}`}
            className="absolute -top-1.5 -right-1.5 rounded-full bg-background/90 p-0.5 text-foreground shadow-sm transition-opacity group-hover:opacity-100"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
