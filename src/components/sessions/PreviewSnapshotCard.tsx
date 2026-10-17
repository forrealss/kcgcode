/**
 * Kartu kecil di atas composer: snapshot preview otomatis setelah turn agent
 * selesai — hasilnya terlihat tanpa membuka preview. Tap = layar penuh
 * (lightbox), X = sembunyikan sampai snapshot berikutnya. Disembunyikan
 * selama agent masih merespon (snapshot lama sudah basi).
 */
import { ImageIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { ImageLightbox } from "@/components/sessions/ImageLightbox";
import { attachmentUrl } from "@/lib/api";
import { getPreviewSnapshot } from "@/lib/preview-api";
import { onPreviewSnapshot } from "@/lib/preview-events";
import { formatTime } from "@/lib/time";
import type { PreviewSnapshot } from "@/types";

export function PreviewSnapshotCard({
  sessionId,
  hidden,
}: {
  sessionId: string;
  /** Agent sedang merespon — snapshot terakhir sudah basi. */
  hidden: boolean;
}) {
  const [snapshot, setSnapshot] = useState<PreviewSnapshot | null>(null);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSnapshot(null);
    void getPreviewSnapshot(sessionId).then(
      (s) => {
        if (!cancelled) setSnapshot((cur) => cur ?? s);
      },
      () => {},
    );
    const off = onPreviewSnapshot((e) => {
      if (e.sessionId === sessionId) setSnapshot(e.snapshot);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [sessionId]);

  if (!snapshot || hidden || dismissedAt === snapshot.takenAt) return null;
  const src = attachmentUrl(sessionId, snapshot.attachmentId);
  const label = `Preview ${snapshot.path === "/" ? "" : `${snapshot.path} `}after the last turn`;

  return (
    <div className="mx-auto w-full max-w-3xl px-3 pb-2 sm:px-4">
      <div className="flex items-center gap-3 rounded-xl border bg-card p-2 pr-1">
        <button
          type="button"
          onClick={() => setLightbox(0)}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          aria-label={`Open ${label.toLowerCase()}`}
        >
          <img
            src={src}
            alt=""
            className="h-14 w-10 shrink-0 rounded-md border object-cover object-top"
          />
          <span className="flex min-w-0 flex-col">
            <span className="flex items-center gap-1.5 truncate text-sm font-medium">
              <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{label}</span>
            </span>
            <span className="text-xs text-muted-foreground">{formatTime(snapshot.takenAt)}</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => setDismissedAt(snapshot.takenAt)}
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
          aria-label="Hide snapshot"
        >
          <XIcon className="size-4" />
        </button>
      </div>
      <ImageLightbox images={[{ src, alt: label }]} index={lightbox} onIndexChange={setLightbox} />
    </div>
  );
}
