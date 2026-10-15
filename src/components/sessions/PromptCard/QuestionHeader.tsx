/**
 * Header kartu pertanyaan: judul = PERTANYAAN itu sendiri (bukan label
 * "Question"), deskripsi = status kirim / posisi wizard / petunjuk cara
 * menjawab. Pertanyaan sangat panjang dibatasi tingginya (scroll sendiri)
 * agar opsi tetap kelihatan di layar HP.
 */
import { HelpCircleIcon, ListChecksIcon, ListTreeIcon } from "lucide-react";
import { CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import type { InteractivePrompt } from "@/types";

export function QuestionHeader({
  prompt,
  isMulti,
  isMultiQuestion,
  questionCount,
  stepIdx,
  answeredCount,
  sending,
}: {
  prompt: InteractivePrompt;
  /** Pertanyaan tunggal multi-select. */
  isMulti: boolean;
  /** Wizard multi-question. */
  isMultiQuestion: boolean;
  questionCount: number;
  stepIdx: number;
  answeredCount: number;
  /** Ada aksi yang sedang dikirim. */
  sending: boolean;
}) {
  const hint = isMulti ? "Select all that apply" : "Tap an option to answer";
  const optionCount = prompt.options?.length ?? 0;

  return (
    <CardHeader className="flex max-h-[30dvh] shrink-0 flex-row items-start gap-3 overflow-y-auto px-5 pt-4 pb-3">
      <span
        aria-hidden
        className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-foreground/80"
      >
        {prompt.kind === "plan" ? (
          <ListTreeIcon className="size-4" />
        ) : isMultiQuestion || isMulti ? (
          <ListChecksIcon className="size-4" />
        ) : (
          <HelpCircleIcon className="size-4" />
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <CardTitle
          id={`q-${prompt.id}-title`}
          className="wrap-anywhere text-[17px] leading-6 font-semibold tracking-tight sm:text-base"
        >
          {isMultiQuestion
            ? `The agent has ${questionCount} questions`
            : (prompt.title ?? "The agent has a question")}
        </CardTitle>
        <CardDescription className="flex items-center gap-1.5 text-[13px]">
          {sending ? (
            <>
              <Spinner className="size-3" />
              Sending…
            </>
          ) : isMultiQuestion ? (
            `Question ${stepIdx + 1} of ${questionCount} · ${answeredCount} answered`
          ) : optionCount > 0 ? (
            <>
              {/* HP: petunjuk sentuh. Desktop: pintasan angka. */}
              <span className="sm:hidden">{hint}</span>
              <span className="hidden sm:inline">
                {isMulti ? hint : "Click an option"} · press{" "}
                <kbd className="rounded border px-1 font-mono text-[10px]">1</kbd>
                {optionCount > 1 && (
                  <>
                    –
                    <kbd className="rounded border px-1 font-mono text-[10px]">
                      {Math.min(optionCount, 9)}
                    </kbd>
                  </>
                )}
              </span>
            </>
          ) : (
            hint
          )}
        </CardDescription>
      </div>
    </CardHeader>
  );
}
