/**
 * Sub-agent di timeline — progressive disclosure supaya muat di HP:
 *
 * - `SubagentCard`: kartu ringkas di alur turn (jenis agent, tugas, status,
 *   statistik; saat berjalan menampilkan tool terakhir). Tidak bersarang /
 *   menjorok, jadi tidak menyempitkan timeline di layar kecil.
 * - `SubagentSheet`: ketuk kartu -> AdwDialog (bottom sheet di HP, dialog di
 *   desktop) berisi detail kerja: statistik, instruksi dari agent utama,
 *   aktivitas langkah demi langkah (reasoning, tool, pesan — sub-agent
 *   bersarang tampil sebagai kartu yang bisa dibuka lagi), dan hasil akhir.
 *
 * Data datang dari indeks sub-agent seluruh Session (`SubagentIndexContext`,
 * disediakan `SessionTimeline`) — kerja sub-agent latar belakang bisa
 * tersimpan di turn lain dari tool call-nya.
 */
import {
  BotIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleSlashIcon,
  CircleXIcon,
  ClockFadingIcon,
  MessageSquareTextIcon,
} from "lucide-react";
import { createContext, type ReactNode, useContext, useState } from "react";
import { MarkdownContent } from "@/components/sessions/MarkdownContent";
import {
  ReasoningStep,
  renderTimelineStep,
  stepIcon,
  toolIcon,
} from "@/components/sessions/ThoughtProcessBlock";
import { AdwDialogContent } from "@/components/ui/adw-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { formatTokens } from "@/lib/context-usage";
import {
  isSubagentTool,
  type SubagentIndex,
  type SubagentStatus,
  type SubagentView,
  subagentView,
} from "@/lib/subagents";
import { formatDuration } from "@/lib/time";
import { partText, toolLabel } from "@/lib/turns";
import { cn } from "@/lib/utils";
import type { MessagePart } from "@/types";

/** Indeks sub-agent seluruh Session (lihat `indexSubagents`). */
export const SubagentIndexContext = createContext<SubagentIndex>(new Map());

const STATUS_LABEL: Record<SubagentStatus, string> = {
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  stopped: "Stopped",
};

function StatusIcon({ status, className }: { status: SubagentStatus; className?: string }) {
  if (status === "running") return <Spinner className={cn("size-3.5", className)} />;
  const Icon =
    status === "completed" ? CircleCheckIcon : status === "failed" ? CircleXIcon : CircleSlashIcon;
  return (
    <Icon
      aria-hidden
      className={cn(
        "size-3.5",
        status === "completed" && "text-emerald-600 dark:text-emerald-400",
        status === "failed" && "text-destructive",
        status === "stopped" && "text-muted-foreground",
        className,
      )}
    />
  );
}

/** Nama jenis agent untuk tampilan (`explore` -> `Explore`). */
function agentTitle(v: SubagentView): string {
  const name = v.agentType ?? "Sub-agent";
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Statistik ringkas: "3 tools · 26.3k tokens · 4s". */
function statsLine(v: SubagentView): string {
  const parts = [`${v.toolUses} ${v.toolUses === 1 ? "tool" : "tools"}`];
  if (v.tokens !== null) parts.push(`${formatTokens(v.tokens)} tokens`);
  if (v.durationMs !== null && v.status !== "running") parts.push(formatDuration(v.durationMs));
  return parts.join(" · ");
}

/** Kartu ringkas sub-agent di alur turn; ketuk untuk detail. */
export function SubagentCard({ part, className }: { part: MessagePart; className?: string }) {
  const index = useContext(SubagentIndexContext);
  const [open, setOpen] = useState(false);
  const view = subagentView(part, index.get(String(part.callID ?? part.id)));
  const title = agentTitle(view);
  const live =
    view.status === "running" ? (view.lastTool ? `Running ${view.lastTool}…` : "Starting…") : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${title} sub-agent: ${view.description ?? ""}. ${STATUS_LABEL[view.status]}. Show details`}
        className={cn(
          "flex w-full min-w-0 items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left shadow-xs transition-colors outline-none",
          "hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/40 active:bg-muted/60",
          className,
        )}
      >
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400 [&>svg]:size-4"
        >
          <BotIcon />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5 text-[14px] leading-5">
            <span className="truncate font-medium">{title}</span>
            <StatusIcon status={view.status} className="shrink-0" />
          </span>
          {view.description && (
            <span className="truncate text-[13px] leading-snug text-muted-foreground">
              {view.description}
            </span>
          )}
          <span className="truncate text-[12px] leading-snug text-muted-foreground/80 tabular-nums">
            {live ? `${live} · ${statsLine(view)}` : statsLine(view)}
          </span>
        </span>
        <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </button>
      <SubagentSheet view={view} open={open} onOpenChange={setOpen} />
    </>
  );
}

/** Judul seksi detail (pola judul grup AdwPreferencesGroup). */
function SheetSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="px-1 text-[13px] font-semibold">{title}</h3>
      {children}
    </section>
  );
}

/** Detail kerja satu sub-agent (bottom sheet di HP, dialog di desktop). */
export function SubagentSheet({
  view,
  open,
  onOpenChange,
}: {
  view: SubagentView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [promptExpanded, setPromptExpanded] = useState(false);
  // Teks terakhir sub-agent yang sama dengan hasil tidak diulang di aktivitas.
  const steps = view.steps.filter(
    (p, i, all) =>
      !(
        i === all.length - 1 &&
        p.type === "text" &&
        view.result !== null &&
        (partText(p) ?? "").trim() === view.result.trim()
      ) &&
      // Reasoning tanpa isi (disembunyikan provider) tidak informatif di sini.
      !(p.type === "reasoning" && (partText(p) ?? "").trim() === ""),
  );
  const running = view.status === "running";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AdwDialogContent
        title={agentTitle(view)}
        subtitle={view.description ?? undefined}
        bodyClassName="gap-5 overflow-y-auto overscroll-contain"
      >
        {/* Statistik: pil ringkas yang tetap rapi di lebar HP. */}
        <div className="flex flex-wrap gap-1.5 text-[12px] tabular-nums">
          <span className="flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1">
            <StatusIcon status={view.status} />
            {STATUS_LABEL[view.status]}
          </span>
          {view.durationMs !== null && !running && (
            <span className="rounded-full bg-muted px-2.5 py-1">
              {formatDuration(view.durationMs)}
            </span>
          )}
          {view.tokens !== null && (
            <span className="rounded-full bg-muted px-2.5 py-1">
              {formatTokens(view.tokens)} tokens
            </span>
          )}
          <span className="rounded-full bg-muted px-2.5 py-1">
            {view.toolUses} {view.toolUses === 1 ? "tool" : "tools"}
          </span>
        </div>

        {view.prompt && (
          <SheetSection title="Task">
            <div className="rounded-xl border bg-card px-3 py-2.5 text-[13px] leading-relaxed shadow-xs">
              <p
                className={cn("whitespace-pre-wrap break-words", !promptExpanded && "line-clamp-4")}
              >
                {view.prompt}
              </p>
              {view.prompt.length > 240 && (
                <button
                  type="button"
                  onClick={() => setPromptExpanded((v) => !v)}
                  className="mt-1 text-[12px] font-medium text-muted-foreground hover:text-foreground"
                >
                  {promptExpanded ? "Show less" : "Show more"}
                </button>
              )}
            </div>
          </SheetSection>
        )}

        <SheetSection title="Activity">
          {steps.length === 0 ? (
            <p className="rounded-xl border border-dashed px-3 py-2.5 text-[13px] text-muted-foreground">
              {running ? "Getting started…" : "No steps were reported for this sub-agent."}
            </p>
          ) : (
            <div className="flex flex-col px-1">
              {steps.map((p, i) => {
                const last = i === steps.length - 1;
                const key = String(p.id ?? i);
                if (isSubagentTool(p)) {
                  return (
                    <div key={key} className={cn(!last && "pb-3")}>
                      <SubagentCard part={p} />
                    </div>
                  );
                }
                if (p.type === "reasoning") {
                  return (
                    <div key={key}>
                      {renderTimelineStep(
                        stepIcon(ClockFadingIcon, "text-muted-foreground"),
                        <ReasoningStep text={partText(p) ?? ""} />,
                        { last },
                      )}
                    </div>
                  );
                }
                if (p.type === "text") {
                  return (
                    <div key={key}>
                      {renderTimelineStep(
                        stepIcon(MessageSquareTextIcon, "text-muted-foreground"),
                        <div className="text-[13px] text-foreground">
                          <MarkdownContent>{partText(p) ?? ""}</MarkdownContent>
                        </div>,
                        { last },
                      )}
                    </div>
                  );
                }
                const failed = (p.state as { status?: unknown } | undefined)?.status === "error";
                return (
                  <div key={key}>
                    {renderTimelineStep(
                      stepIcon(toolIcon(p), failed ? "text-destructive" : "text-muted-foreground"),
                      // Detail: label utuh (path/perintah panjang dibungkus, maks 3 baris).
                      <span
                        className={cn(
                          "line-clamp-3 font-mono text-[13px] break-all",
                          failed && "text-destructive",
                        )}
                      >
                        {toolLabel(p)}
                      </span>,
                      { last, streaming: running && last },
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </SheetSection>

        {view.result && (
          <SheetSection title="Result">
            <div className="rounded-xl border bg-card px-3 py-2.5 text-[13px] shadow-xs">
              <MarkdownContent>{view.result}</MarkdownContent>
            </div>
          </SheetSection>
        )}
      </AdwDialogContent>
    </Dialog>
  );
}
