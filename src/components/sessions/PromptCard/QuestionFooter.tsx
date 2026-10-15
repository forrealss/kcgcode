/**
 * Footer aksi kartu pertanyaan — selalu di luar area scroll jawaban.
 * - Wizard: Skip | Back · Next/Submit answers.
 * - Multi-select: Skip | Submit.
 * - Single choice: hanya Skip (ketuk opsi langsung menjawab).
 */
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export interface WizardNav {
  isFirst: boolean;
  isLast: boolean;
  /** Langkah aktif sudah dijawab — boleh lanjut. */
  canNext: boolean;
  /** Semua pertanyaan sudah dijawab — boleh kirim. */
  canSubmit: boolean;
  onBack: () => void;
  onNext: () => void;
  onSubmit: () => void;
}

export interface MultiSubmit {
  disabled: boolean;
  busy: boolean;
  onSubmit: () => void;
}

export function QuestionFooter({
  submittingKey,
  wizard,
  multiSubmit,
  onSkip,
}: {
  submittingKey: string | null;
  /** Navigasi wizard multi-question; null = bukan wizard. */
  wizard: WizardNav | null;
  /** Submit multi-select (mode yang MENGUMPULKAN jawaban); null = tanpa Submit. */
  multiSubmit: MultiSubmit | null;
  onSkip: () => void;
}) {
  const sending = submittingKey !== null;
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-2 px-3 pt-1 pb-3 sm:px-4",
        multiSubmit === null && wizard === null && "justify-end",
      )}
    >
      <Button
        type="button"
        variant={wizard ? "ghost" : "secondary"}
        disabled={sending}
        aria-busy={submittingKey === "dismiss"}
        onClick={onSkip}
        className={cn(
          "h-11 rounded-full px-5 text-[15px] sm:h-9 sm:text-sm",
          wizard && "px-3 text-muted-foreground hover:text-foreground sm:px-4",
          multiSubmit !== null && "flex-1 sm:flex-none",
        )}
      >
        {submittingKey === "dismiss" && <Spinner className="size-4" data-icon="inline-start" />}
        Skip
      </Button>
      {wizard && (
        <div className="ms-auto flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={sending || wizard.isFirst}
            onClick={wizard.onBack}
            aria-label="Previous question"
            aria-keyshortcuts="ArrowLeft"
            className="h-11 rounded-full px-4 text-[15px] sm:h-9 sm:text-sm"
          >
            <ChevronLeftIcon className="size-4" data-icon="inline-start" />
            <span className="hidden sm:inline">Back</span>
          </Button>
          {wizard.isLast ? (
            <Button
              type="button"
              disabled={sending || !wizard.canSubmit}
              aria-busy={submittingKey === "multi-question"}
              onClick={wizard.onSubmit}
              className="h-11 rounded-full px-5 text-[15px] sm:h-9 sm:text-sm"
            >
              {submittingKey === "multi-question" && (
                <Spinner className="size-4" data-icon="inline-start" />
              )}
              Submit answers
            </Button>
          ) : (
            <Button
              type="button"
              disabled={sending || !wizard.canNext}
              onClick={wizard.onNext}
              aria-keyshortcuts="ArrowRight"
              className="h-11 rounded-full px-5 text-[15px] sm:h-9 sm:text-sm"
            >
              Next
              <ChevronRightIcon className="size-4" data-icon="inline-end" />
            </Button>
          )}
        </div>
      )}
      {multiSubmit && (
        <Button
          type="button"
          disabled={sending || multiSubmit.disabled}
          aria-busy={multiSubmit.busy}
          onClick={multiSubmit.onSubmit}
          className="h-11 flex-[2] rounded-full px-5 text-[15px] sm:ms-auto sm:h-9 sm:flex-none sm:text-sm"
        >
          {multiSubmit.busy && <Spinner className="size-4" data-icon="inline-start" />}
          Submit
        </Button>
      )}
    </div>
  );
}
