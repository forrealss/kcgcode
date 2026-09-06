/**
 * Render satu pesan user: teks + lampiran gambar (thumbnail) + @file.
 *
 * Part `file` gambar (punya `attachmentId` + mime image) dimuat bytes-nya
 * lewat route HTTP `/api/uploads/...` (`attachmentUrl`); part `file` lain
 * (echo @file) tampil sebagai chip nama file.
 */
import { FileIcon } from "lucide-react";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Message, MessageContent, MessageFooter } from "@/components/ui/message";
import { attachmentUrl } from "@/lib/api";
import { formatTime } from "@/lib/time";
import { textOf } from "@/lib/turns";
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
  const images = m.parts.filter(isImageAttachment);
  const attachedFiles = m.parts
    .map((p) => ({ part: p, filename: p.filename }))
    .filter(
      (x): x is { part: MessagePart; filename: string } =>
        x.part.type === "file" && !isImageAttachment(x.part) && typeof x.filename === "string",
    );
  return (
    <Message align="end">
      <MessageContent>
        <Bubble>
          <BubbleContent className="whitespace-pre-wrap">{textOf(m.parts)}</BubbleContent>
          {images.length > 0 && (
            <div className="mt-1.5 grid max-w-xs grid-cols-2 gap-1.5">
              {images.map((p) => (
                <img
                  key={p.attachmentId}
                  src={attachmentUrl(m.sessionId, p.attachmentId)}
                  alt={p.filename ?? "attached image"}
                  className="max-h-40 w-full rounded-md border object-contain"
                  loading="lazy"
                />
              ))}
            </div>
          )}
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
        <MessageFooter>{formatTime(m.createdAt)}</MessageFooter>
      </MessageContent>
    </Message>
  );
}
