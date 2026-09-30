/**
 * Render satu pesan user: teks + lampiran gambar (thumbnail) + @file.
 *
 * Part `file` gambar (punya `attachmentId` + mime image) dimuat bytes-nya
 * lewat route HTTP `/api/uploads/...` (`attachmentUrl`); part `file` lain
 * (echo @file) tampil sebagai chip nama file.
 */
import { FileIcon } from "lucide-react";
import { useState } from "react";
import { ImageLightbox } from "@/components/sessions/ImageLightbox";
import { CopyMessageButton } from "@/components/sessions/MessageActions";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Message, MessageContent, MessageFooter } from "@/components/ui/message";
import { attachmentUrl } from "@/lib/api";
import { formatTime } from "@/lib/time";
import { textOf } from "@/lib/turns";
import { cn } from "@/lib/utils";
import type { MessagePart, SessionMessage } from "@/types";

export interface UserMessageProps {
  message: SessionMessage;
}

/** Part `file` yang merupakan gambar lampiran (punya attachmentId + mime image). */
function isImageAttachment(
  p: MessagePart,
): p is MessagePart & { mime: string; attachmentId: string } {
  return (
    p.type === "file" &&
    typeof p.mime === "string" &&
    p.mime.startsWith("image/") &&
    typeof p.attachmentId === "string"
  );
}

export function UserMessage({ message: m }: UserMessageProps) {
  const [preview, setPreview] = useState<number | null>(null);
  const images = m.parts.filter(isImageAttachment);
  const text = textOf(m.parts);
  const lightboxImages = images.map((p) => ({
    src: attachmentUrl(m.sessionId, p.attachmentId),
    alt: p.filename ?? "Attached image",
  }));
  const attachedFiles = m.parts
    .map((p) => ({ part: p, filename: p.filename }))
    .filter(
      (x): x is { part: MessagePart; filename: string } =>
        x.part.type === "file" && !isImageAttachment(x.part) && typeof x.filename === "string",
    );
  return (
    <Message align="end">
      <MessageContent>
        {/* Gambar di atas bubble teks (rata kanan), ala aplikasi chat:
            1 gambar = satu kartu besar; 2+ = grid 2 kolom kotak. Klik =
            pratinjau layar penuh. */}
        {images.length > 0 && (
          <ul
            aria-label={`${images.length} attached ${images.length === 1 ? "image" : "images"}`}
            className={cn(
              "grid gap-1.5 self-end",
              images.length === 1 ? "w-full max-w-72 grid-cols-1" : "w-full max-w-80 grid-cols-2",
            )}
          >
            {lightboxImages.map((img, i) => (
              <li key={img.src} className={cn(images.length === 3 && i === 0 && "col-span-2")}>
                <button
                  type="button"
                  onClick={() => setPreview(i)}
                  aria-label={`Preview ${img.alt}`}
                  className="group/img block w-full overflow-hidden rounded-xl border bg-muted outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <img
                    src={img.src}
                    alt={img.alt}
                    loading="lazy"
                    draggable={false}
                    className={cn(
                      "w-full object-cover transition-transform duration-200 group-hover/img:scale-[1.02]",
                      images.length === 1 ? "max-h-80" : "aspect-square",
                      images.length === 3 && i === 0 && "aspect-[2/1]",
                    )}
                  />
                </button>
              </li>
            ))}
          </ul>
        )}

        {(text !== "" || attachedFiles.length > 0) && (
          <Bubble>
            {text !== "" && <BubbleContent className="whitespace-pre-wrap">{text}</BubbleContent>}
            {attachedFiles.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {attachedFiles.map(({ filename }) => (
                  <span
                    key={filename}
                    className="inline-flex max-w-full items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                  >
                    <FileIcon className="size-3 shrink-0" />
                    <span className="truncate">{filename}</span>
                  </span>
                ))}
              </div>
            )}
          </Bubble>
        )}
        {/* Copy di kiri waktu (pesan user rata kanan). */}
        <MessageFooter className="gap-1">
          <CopyMessageButton text={text} />
          <span className="text-muted-foreground/80">{formatTime(m.createdAt)}</span>
        </MessageFooter>
        <ImageLightbox images={lightboxImages} index={preview} onIndexChange={setPreview} />
      </MessageContent>
    </Message>
  );
}
