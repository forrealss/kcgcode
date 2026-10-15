/**
 * Render satu turn assistant (Satu kesatuan respon model).
 *
 * Isi: satu atau lebih blok "Thought process" collapsible (kluster steps
 * reasoning/tool per round — `ThoughtProcessBlock.tsx`), diikuti jawaban
 * teks / error / penanda compact / kartu sub-agent, lalu footer waktu (+
 * durasi thinking, token, dan estimasi biaya bila dinyalakan) setelah turn
 * selesai.
 */
import { CircleAlertIcon, FoldVerticalIcon } from "lucide-react";
import { MarkdownContent } from "@/components/sessions/MarkdownContent";
import { CopyMessageButton } from "@/components/sessions/MessageActions";
import { SubagentCard } from "@/components/sessions/SubagentCard";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Message, MessageContent, MessageFooter } from "@/components/ui/message";
import { useSmoothText } from "@/hooks/useSmoothText";
import { useShowCost } from "@/lib/appearance";
import type { CollapsibleState } from "@/lib/collapsible";
import { compactionLabel, formatTokens } from "@/lib/context-usage";
import { formatCost, turnUsage } from "@/lib/subagents";
import { formatDuration, formatTime } from "@/lib/time";
import { partText, turnBlocks, turnSegments, turnThoughtDuration } from "@/lib/turns";
import { cn } from "@/lib/utils";
import type { AssistantTurnGroup, MessagePart } from "@/types";
import { ThoughtProcessBlock } from "./ThoughtProcessBlock";

/**
 * Markdown jawaban yang sedang di-stream: teks dikejar halus per frame
 * (`useSmoothText`) agar tidak melompat per potongan delta. Hanya blok
 * terakhir dari turn yang masih berjalan yang dianimasikan; riwayat & blok
 * yang sudah lewat langsung tampil penuh.
 */
function StreamingMarkdown({ text, streaming }: { text: string; streaming: boolean }) {
  const shown = useSmoothText(text, streaming);
  return <MarkdownContent>{shown}</MarkdownContent>;
}

/**
 * Penanda riwayat diringkas (compact): garis pemisah dengan label di tengah,
 * mis. "Conversation compacted · 33.3k → 3.8k tokens". Konteks sebelum
 * penanda ini sudah diganti ringkasan bagi model.
 */
function CompactionMarker({ part, className }: { part: MessagePart; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 py-1.5 text-xs text-muted-foreground", className)}>
      <span aria-hidden className="h-px min-w-4 flex-1 bg-border" />
      <span className="flex min-w-0 items-center gap-1.5 text-center">
        <FoldVerticalIcon aria-hidden className="size-3.5 shrink-0" />
        <span>{compactionLabel(part)}</span>
      </span>
      <span aria-hidden className="h-px min-w-4 flex-1 bg-border" />
    </div>
  );
}

/** Model kadang membalas "(empty)" saat tidak ada teks untuk ditampilkan. */
function isEmptyReply(text: string): boolean {
  return text.trim().toLowerCase() === "(empty)";
}

export interface AssistantTurnProps {
  /** Pesan assistant berurutan dari satu turn balasan model. */
  group: AssistantTurnGroup;
  /** Status toggle blok "Thought process" (key `group.id:blockKey`). */
  collapsible: CollapsibleState;
  /** Toggle satu blok Thought process. */
  onToggle: (key: string) => void;
}

export function AssistantTurn({ group, collapsible, onToggle }: AssistantTurnProps) {
  const showCost = useShowCost();
  const m = group.messages[0];
  if (!m) return null;
  const segments = turnSegments(group.messages);
  const streaming = m.streaming === true || group.messages.some((msg) => msg.streaming === true);
  const blocks = turnBlocks(segments);
  // Turn yang isinya hanya kerja sub-agent latar belakang / metadata (tampil
  // di kartu sub-agent turn lain) tidak dirender sebagai turn kosong.
  if (blocks.length === 0 && !streaming) return null;
  const usage = !streaming ? turnUsage(group.messages) : null;
  // Durasi thinking untuk footer — hanya dihitung setelah turn selesai.
  const thoughtMs = !streaming ? turnThoughtDuration(group.messages) : null;
  // Teks jawaban (tanpa thinking/tool) untuk tombol Copy, dipisah paragraf.
  const answerText = blocks
    .map((b) =>
      b.content?.kind === "text" && !isEmptyReply(b.content.text) ? b.content.text.trim() : "",
    )
    .filter((t) => t !== "")
    .join("\n\n");

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
              {block.content?.kind === "subagent" && (
                <SubagentCard part={block.content.part} className={cn(hasSteps && "mt-3")} />
              )}
              {block.content?.kind === "compaction" && (
                <CompactionMarker part={block.content.part} className={cn(hasSteps && "mt-3")} />
              )}
              {/* Balasan kosong dari model ("(empty)") — tetap tampil sebagai
                  penanda, tapi kecil & redup agar tidak terbaca sebagai jawaban. */}
              {block.content?.kind === "text" && isEmptyReply(block.content.text) && (
                <p className={cn("text-xs text-muted-foreground/70 italic", hasSteps && "mt-2")}>
                  {block.content.text.trim()}
                </p>
              )}
              {block.content?.kind === "text" &&
                block.content.text !== "" &&
                !isEmptyReply(block.content.text) && (
                  <div className={cn(hasSteps && "mt-3")}>
                    <Bubble variant="ghost" className="max-w-full">
                      <BubbleContent className="w-full">
                        <StreamingMarkdown
                          text={block.content.text}
                          streaming={streaming && isLastBlock}
                        />
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
          <MessageFooter className="gap-1 animate-in fade-in-0 slide-in-from-right-4 duration-500">
            <span className="text-muted-foreground/80">
              {formatTime(m.createdAt)}
              {thoughtMs !== null && (
                <>
                  <span className="mx-1.5 text-muted-foreground/40" aria-hidden>
                    ●
                  </span>
                  <span>thoughts {formatDuration(thoughtMs)}</span>
                </>
              )}
              {usage && (
                <>
                  <span className="mx-1.5 text-muted-foreground/40" aria-hidden>
                    ●
                  </span>
                  <span
                    className="tabular-nums"
                    title={`Input ${formatTokens(usage.input)} · cache read ${formatTokens(usage.cacheRead)} · cache write ${formatTokens(usage.cacheWrite)} · output ${formatTokens(usage.output)}`}
                  >
                    {formatTokens(usage.total)} tokens
                    {showCost && usage.cost !== null && ` · ${formatCost(usage.cost)}`}
                  </span>
                </>
              )}
            </span>
            <CopyMessageButton text={answerText} className="ml-1" />
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
  );
}
