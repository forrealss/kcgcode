/**
 * Render satu turn assistant (Satu kesatuan respon model).
 *
 * Isi: satu atau lebih blok "Thought process" collapsible (kluster steps
 * reasoning/tool per round — `ThoughtProcessBlock.tsx`), diikuti jawaban
 * teks / error, lalu footer waktu (+ durasi thinking) setelah turn selesai.
 */
import { CircleAlertIcon } from "lucide-react";
import { MarkdownContent } from "@/components/sessions/MarkdownContent";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Message, MessageContent, MessageFooter } from "@/components/ui/message";
import type { CollapsibleState } from "@/lib/collapsible";
import { formatDuration, formatTime } from "@/lib/time";
import { partText, turnBlocks, turnSegments, turnThoughtDuration } from "@/lib/turns";
import { cn } from "@/lib/utils";
import type { AssistantTurnGroup } from "@/types";
import { ThoughtProcessBlock } from "./ThoughtProcessBlock";

export interface AssistantTurnProps {
  /** Pesan assistant berurutan dari satu turn balasan model. */
  group: AssistantTurnGroup;
  /** Status toggle blok "Thought process" (key `group.id:blockKey`). */
  collapsible: CollapsibleState;
  /** Toggle satu blok Thought process. */
  onToggle: (key: string) => void;
}

export function AssistantTurn({ group, collapsible, onToggle }: AssistantTurnProps) {
  const m = group.messages[0];
  if (!m) return null;
  const segments = turnSegments(group.messages);
  const streaming = m.streaming === true || group.messages.some((msg) => msg.streaming === true);
  const blocks = turnBlocks(segments);
  // Durasi thinking untuk footer — hanya dihitung setelah turn selesai.
  const thoughtMs = !streaming ? turnThoughtDuration(group.messages) : null;

  return (
    <Message align="start">
      <MessageContent>
        {blocks.map((block, bi) => {
          const isLastBlock = bi === blocks.length - 1;
          const hasSteps = block.steps.length > 0;
          return (
            <div key={block.key}>
              {/* Thought process block — pisah per round thinking */}
              <ThoughtProcessBlock
                groupId={group.id}
                blockKey={block.key}
                steps={block.steps}
                collapsible={collapsible}
                onToggle={onToggle}
                streaming={streaming}
                isLastBlock={isLastBlock}
              />
              {/* Konten teks/error setelah thinking round ini */}
              {block.content?.kind === "error" && (
                <div className={cn(hasSteps && "mt-3")}>
                  <Bubble variant="destructive">
                    <BubbleContent>
                      <div className="flex gap-2">
                        <CircleAlertIcon
                          className="mt-0.5 size-4 shrink-0"
                          data-icon="inline-start"
                        />
                        <span className="whitespace-pre-wrap">
                          {partText(block.content.part) ??
                            "Something went wrong while processing the prompt."}
                        </span>
                      </div>
                    </BubbleContent>
                  </Bubble>
                </div>
              )}
              {block.content?.kind === "text" && block.content.text !== "" && (
                <div className={cn(hasSteps && "mt-3")}>
                  <Bubble variant="ghost" className="max-w-full">
                    <BubbleContent className="w-full">
                      <MarkdownContent>{block.content.text}</MarkdownContent>
                    </BubbleContent>
                  </Bubble>
                </div>
              )}
            </div>
          );
        })}
        {/* Footer: tersembunyi saat streaming, muncul dengan animasi fade +
            slide dari kanan setelah turn selesai. Format:
            HH:MM:SS · ● · thoughts Xs */}
        {!streaming && (
          <MessageFooter className="animate-in fade-in-0 slide-in-from-right-4 duration-500">
            {formatTime(m.createdAt)}
            {thoughtMs !== null && (
              <>
                <span className="mx-1.5 text-muted-foreground/40" aria-hidden>
                  ●
                </span>
                <span>thoughts {formatDuration(thoughtMs)}</span>
              </>
            )}
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
  );
}
