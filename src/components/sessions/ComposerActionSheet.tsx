/**
 * Sheet aksi mobile di composer (lampirkan file + ganti agent mode).
 *
 * Susunan: judul kecil "Add to message" + aksi lampiran sebagai baris
 * (ikon, label, keterangan) — lalu grup "Mode" berisi pilihan agent ala
 * radio. Mode pembantu (compaction/title/summary) dilipat di "More modes".
 */
import { ChevronRightIcon, PaperclipIcon } from "lucide-react";
import { AgentModeList } from "@/components/sessions/AgentModeList";
import { SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { UseAgentPickerResult } from "@/hooks/useAgentPicker";

export interface ComposerActionSheetProps {
  /** Input tidak boleh dipakai (Session mati / sibuk) — aksi ikut terkunci. */
  disabled: boolean;
  /** Buka file picker (sheet ditutup oleh pemanggil). */
  onPickImage: () => void;
  agentPicker: UseAgentPickerResult;
  activeAgent: string | null;
  onPickAgent: (name: string | null) => void;
}

export function ComposerActionSheet({
  disabled,
  onPickImage,
  agentPicker,
  activeAgent,
  onPickAgent,
}: ComposerActionSheetProps) {
  return (
    <SheetContent
      side="bottom"
      className="max-h-[80dvh] gap-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      <SheetHeader className="sr-only">
        <SheetTitle>Message options</SheetTitle>
        <SheetDescription>Attach files or choose how the agent works.</SheetDescription>
      </SheetHeader>

      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain px-3 pt-1 pb-1">
        {/* Lampiran */}
        <section aria-labelledby="sheet-attach" className="flex flex-col gap-1">
          <h3 id="sheet-attach" className="px-3 pb-1 text-xs font-medium text-muted-foreground">
            Add to message
          </h3>
          <button
            type="button"
            disabled={disabled}
            onClick={onPickImage}
            className="flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-muted disabled:opacity-50"
          >
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400"
              aria-hidden
            >
              <PaperclipIcon className="size-[18px]" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[15px] leading-5">Photos and files</span>
              <span className="text-[13px] leading-snug text-muted-foreground">
                Images, documents, code, and more
              </span>
            </span>
            <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        </section>

        <div className="mx-3 border-t" />

        {/* Mode agent */}
        <section aria-labelledby="sheet-mode" className="flex flex-col gap-1">
          <div className="flex flex-col px-3 pb-1">
            <h3 id="sheet-mode" className="text-xs font-medium text-muted-foreground">
              Mode
            </h3>
            <p className="text-[12px] text-muted-foreground/80">
              How the agent handles your next message
            </p>
          </div>
          <div>
            <AgentModeList
              variant="sheet"
              agents={agentPicker.agents}
              loading={agentPicker.loading}
              error={agentPicker.error}
              activeAgent={activeAgent}
              saving={agentPicker.saving}
              disabled={disabled}
              onPick={onPickAgent}
            />
          </div>
        </section>
      </div>
    </SheetContent>
  );
}
