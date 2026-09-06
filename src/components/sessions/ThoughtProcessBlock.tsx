/**
 * Satu blok "Thought process" collapsible di dalam turn assistant.
 *
 * Berisi kluster steps berurutan (reasoning/tool) dengan garis penghubung
 * antar langkah + tanda "Done" setelah blok selesai di-stream. Status toggle
 * dikelola pemilik daftar (key `groupId:blockKey`) agar blok baru saat
 * streaming otomatis masuk keadaan collapsed tanpa menyentuh toggle user.
 */
import {
  ChevronRightIcon,
  CircleCheckBigIcon,
  ClockFadingIcon,
  FileIcon,
  FolderIcon,
  GlobeIcon,
  type LucideIcon,
  PenLineIcon,
  SearchIcon,
  TerminalIcon,
  WrenchIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { type CollapsibleState, isCollapsibleExpanded } from "@/lib/collapsible";
import { partText, toolLabel } from "@/lib/turns";
import { cn } from "@/lib/utils";
import type { MessagePart, TurnSegment } from "@/types";

/** Step dalam blok: reasoning atau tool call. */
export type ThoughtStep = Extract<TurnSegment, { kind: "reasoning" | "tool" }>;

export interface ThoughtProcessBlockProps {
  /** Id grup turn (untuk key collapsible `groupId:blockKey`). */
  groupId: string;
  /** Key blok (dari key segmen pertama). */
  blockKey: string;
  steps: ThoughtStep[];
  collapsible: CollapsibleState;
  onToggle: (key: string) => void;
  /** Turn masih streaming — blok terakhir menampilkan indikator aktif. */
  streaming: boolean;
  /** Apakah ini blok terakhir dalam turn (menentukan indikator streaming). */
  isLastBlock: boolean;
}

/**
 * Ikon badge tool mengikuti nama tool (fallback: kunci inggris).
 */
const TOOL_ICONS: Record<string, LucideIcon> = {
  read: FileIcon,
  list: FolderIcon,
  glob: FolderIcon,
  edit: PenLineIcon,
  write: PenLineIcon,
  patch: PenLineIcon,
  bash: TerminalIcon,
  shell: TerminalIcon,
  grep: SearchIcon,
  webfetch: GlobeIcon,
};

function toolIcon(part: MessagePart): LucideIcon {
  const name = (typeof part.tool === "string" ? part.tool : part.type).toLowerCase();
  return (name !== "" && TOOL_ICONS[name]) || WrenchIcon;
}

/** Ikon kecil (14px) untuk langkah timeline & indikator status. */
function stepIcon(Icon: LucideIcon, className?: string) {
  return <Icon className={cn("size-3.5 shrink-0", className)} data-icon="inline-start" />;
}

/**
 * Baris ringkas isi reasoning di timeline. Saat masih di-stream (teks belum
 * lengkap) tampil redup; setelah selesai tampil apa adanya — keduanya bisa
 * panjang, jadi tinggi dibatasi + scroll internal.
 */
function ReasoningStep({ text }: { text: string }) {
  const dim = text.trim() === "";
  return (
    <div
      className={cn(
        "max-h-40 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed",
        dim && "text-muted-foreground/50",
      )}
    >
      {dim ? "organizing thoughts…" : text}
    </div>
  );
}

/**
 * Satu langkah timeline di dalam blok "Thought process": ikon status di
 * kiri (dengan garis penghubung antar langkah) + isi di kanan.
 *
 * Garis digambar ABSOLUT (bukan flex-1 di kolom stretch): `align-self:
 * stretch` hanya membentang sampai content box sehingga di langkah
 * satu-baris sisa ruang garisnya ~0px (tak terlihat). Absolut terhadap
 * PADDING box -> `bottom-0` menyentuh dasar `pb-5`, artinya garis selalu
 * tersambung ke langkah berikutnya berapa pun tinggi kontennya.
 */
function renderTimelineStep(
  icon: ReactNode,
  content: ReactNode,
  opts?: { last?: boolean; streaming?: boolean },
) {
  return (
    <div className={cn("relative flex gap-2.5", !opts?.last && "pb-5")}>
      {/* Garis penghubung: mulai tepat di bawah ikon (mt-0.5 + size-5 =
          22px) sampai dasar row; x=10px = pusat kolom ikon (size-5). */}
      {!opts?.last && (
        <span className="absolute top-6 bottom-0 left-2.5 -ml-px w-px bg-border" aria-hidden />
      )}
      <span
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
          opts?.streaming && "animate-pulse text-foreground/70",
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1 text-sm text-muted-foreground">{content}</div>
    </div>
  );
}

export function ThoughtProcessBlock({
  groupId,
  blockKey,
  steps,
  collapsible,
  onToggle,
  streaming,
  isLastBlock,
}: ThoughtProcessBlockProps) {
  if (steps.length === 0) return null;
  const collapsibleKey = `${groupId}:${blockKey}`;
  const expanded = isCollapsibleExpanded(collapsible, collapsibleKey);
  // Blok terakhir yang masih streaming: "Done" belum tampil.
  const blockStreaming = streaming && isLastBlock;

  return (
    <Collapsible open={expanded}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 self-start gap-1 px-2 text-xs text-muted-foreground"
        onClick={() => onToggle(collapsibleKey)}
        aria-expanded={expanded}
      >
        Thought process
        {/* Ikon sengaja di KANAN label */}
        <ChevronRightIcon
          data-icon="inline-end"
          className={cn("transition-transform", expanded && "rotate-90")}
        />
      </Button>
      <CollapsibleContent>
        <div className="flex flex-col px-3 pt-1">
          {steps.map((seg, i) =>
            seg.kind === "reasoning" ? (
              <div key={seg.key}>
                {renderTimelineStep(
                  stepIcon(ClockFadingIcon, "text-muted-foreground"),
                  <ReasoningStep text={partText(seg.part) ?? ""} />,
                  {
                    last: blockStreaming && i === steps.length - 1,
                    streaming: blockStreaming && i === steps.length - 1,
                  },
                )}
              </div>
            ) : (
              <div key={seg.key}>
                {renderTimelineStep(
                  stepIcon(toolIcon(seg.part), "text-muted-foreground"),
                  <span className="font-mono text-[13px]">{toolLabel(seg.part)}</span>,
                  { last: blockStreaming && i === steps.length - 1, streaming: false },
                )}
              </div>
            ),
          )}
          {!blockStreaming &&
            renderTimelineStep(
              stepIcon(CircleCheckBigIcon, "text-muted-foreground"),
              <span>Done</span>,
              { last: true },
            )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
