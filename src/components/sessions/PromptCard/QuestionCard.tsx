/**
 * Kartu pertanyaan agent (`question` / persetujuan rencana `plan`).
 *
 * - Single choice: baris opsi langsung menjawab saat diklik (`{ option }`).
 * - Multi-select (`multiple: true`): checkbox + Submit, dikirim sebagai
 *   `{ options: string[] }`.
 * - Multi-question: wizard bertahap; seluruh jawaban dikirim SEKALIGUS
 *   sebagai `{ answers: string[][] }` (satu array label per pertanyaan).
 * - Jawaban bebas (`custom`) tersedia di semua mode; Skip menolak request.
 *
 * Pintasan keyboard (desktop), diabaikan saat mengetik / ada modifier:
 * angka 1–9 = pilih opsi ke-n; wizard: ← / → = langkah sebelumnya /
 * berikutnya.
 */
import { useEffect, useRef } from "react";
import { MarkdownContent } from "@/components/sessions/MarkdownContent";
import { Card, CardContent } from "@/components/ui/card";
import { collectAnswer, getPromptQuestions } from "@/lib/prompts";
import { cn } from "@/lib/utils";
import type { InteractivePrompt } from "@/types";
import { isTextEntryTarget } from "./keyboard";
import { CustomAnswerRow, OptionList, OptionRows } from "./OptionList";
import { QuestionFooter } from "./QuestionFooter";
import { QuestionHeader } from "./QuestionHeader";
import { QuestionWizard, StepIndicator } from "./QuestionWizard";
import type { PromptSubmission } from "./usePromptSubmission";
import { useQuestionAnswers } from "./useQuestionAnswers";

export function QuestionCard({
  prompt,
  submission,
  docked,
}: {
  prompt: InteractivePrompt;
  submission: PromptSubmission;
  /** Kartu menggantikan composer: hanya daftar jawaban yang scroll. */
  docked: boolean;
}) {
  const { submittingKey, error, submit } = submission;
  const isMenu = prompt.type === "menu";
  // Question multi-select: jawaban dikumpulkan lewat checkbox lalu dikirim
  // sekaligus — bukan satu klik per opsi.
  const isMulti = isMenu && prompt.multiple === true;
  // Multi-question: seluruh pertanyaan request dirender dalam satu kartu.
  const questions = getPromptQuestions(prompt);
  const isMultiQuestion = isMenu && questions.length > 1;
  const answers = useQuestionAnswers(prompt.id, questions.length);
  const { stepIdx, goTo, isAnswered } = answers;
  const customPlaceholder =
    prompt.kind === "plan" ? "Tell the agent what to change…" : "Type your own answer…";

  /** Kirim jawaban bebas dari input kustom (bentuk respon sama dengan opsi). */
  const submitCustom = () => {
    const text = answers.customText.trim();
    if (text.length === 0) return;
    answers.setCustomText("");
    submit("custom", { option: text });
  };

  /**
   * Kirim jawaban multi-select: seluruh opsi tercentang (+ teks kustom bila
   * diisi) sebagai satu array label — bentuk respon `{ options: string[] }`.
   */
  const submitChecked = () => {
    const labels = collectAnswer(answers.checked, answers.customText);
    if (labels.length === 0) return;
    answers.setCustomText("");
    submit("multi-submit", { options: labels });
  };

  /**
   * Kirim jawaban multi-question: SATU array label per pertanyaan (urut
   * daftar). Semua pertanyaan wajib terjawab (opsi dan/atau teks kustom) —
   * opencode menuntut jawaban per pertanyaan; menolak sebagian = Dismiss.
   */
  const submitAllQuestions = () => {
    if (answers.stepAnswers.some((a) => a.length === 0)) return;
    answers.clearCustomTexts();
    submit("multi-question", { answers: answers.stepAnswers });
  };

  const pickOption = (label: string) => submit(`option-${label}`, { option: label });

  /**
   * Pintasan keyboard question. Handler terbaru disimpan di ref agar
   * listener cukup dipasang sekali.
   */
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandlerRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  keyHandlerRef.current = (e) => {
    if (submittingKey !== null || e.defaultPrevented || e.isComposing) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTextEntryTarget(e.target)) return;
    if (isMultiQuestion) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goTo(stepIdx - 1);
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (isAnswered(stepIdx)) goTo(stepIdx + 1);
        return;
      }
    }
    if (!/^[1-9]$/.test(e.key)) return;
    const n = Number(e.key) - 1;
    if (isMultiQuestion) {
      const q = questions[stepIdx];
      const opt = q?.options?.[n];
      if (!q || !opt) return;
      e.preventDefault();
      answers.pickStepOption(stepIdx, opt.label, q.multiple === true);
      return;
    }
    const opt = (prompt.options ?? [])[n];
    if (!opt) return;
    e.preventDefault();
    if (isMulti) answers.toggleChecked(opt.label);
    else pickOption(opt.label);
  };

  return (
    <Card
      role="dialog"
      aria-labelledby={`q-${prompt.id}-title`}
      className={cn(
        // Permukaan ala AdwDialog: latar "window" (bg-background) supaya boxed
        // list (bg-card) di dalamnya terbaca sebagai grup — sama seperti
        // halaman Settings. Tanpa ring/blur.
        "gap-0 rounded-2xl border bg-background py-0 shadow-lg",
        // Docked (menggantikan composer): kartu mengisi sisa kolom; hanya
        // daftar jawaban yang scroll, judul & footer tetap terlihat.
        docked && "flex min-h-0 shrink flex-col overflow-hidden",
      )}
    >
      <QuestionHeader
        prompt={prompt}
        isMulti={isMulti}
        isMultiQuestion={isMultiQuestion}
        questionCount={questions.length}
        stepIdx={stepIdx}
        answeredCount={answers.answeredCount}
        sending={submittingKey !== null}
      />

      {isMultiQuestion && (
        <StepIndicator
          count={questions.length}
          current={stepIdx}
          answered={isAnswered}
          labels={questions.map((q, qi) => q.header ?? `Question ${qi + 1}`)}
          disabled={submittingKey !== null}
          onSelect={goTo}
        />
      )}

      <CardContent
        className={cn(
          "flex flex-col px-3 sm:px-4",
          "pt-1",
          docked ? "min-h-0 flex-auto overflow-hidden" : "pb-3",
        )}
      >
        {/* biome-ignore lint/a11y/useSemanticElements: wrapper flex/scroll kartu; fieldset mengubah layout & styling */}
        <div
          role="group"
          aria-label="Answers"
          className={cn(
            "flex flex-col",
            docked &&
              "min-h-0 flex-auto overflow-x-hidden overflow-y-auto overscroll-contain pb-3 [scrollbar-width:thin] [-webkit-overflow-scrolling:touch]",
          )}
        >
          {/* Persetujuan rencana: isi rencana (markdown) di atas pilihan —
              ikut area scroll jawaban agar rencana panjang tetap terbaca di HP. */}
          {prompt.kind === "plan" && prompt.detail && (
            <div className="mx-1 mb-3 rounded-xl border bg-card px-4 py-3 text-sm">
              <MarkdownContent>{prompt.detail}</MarkdownContent>
            </div>
          )}
          {isMultiQuestion ? (
            <QuestionWizard
              promptId={prompt.id}
              questions={questions}
              stepIdx={stepIdx}
              submittingKey={submittingKey}
              selections={answers.selections}
              customTexts={answers.customTexts}
              customPlaceholder={customPlaceholder}
              onPickOption={answers.pickStepOption}
              onCustomTextChange={answers.setCustomTextAt}
              onCustomSubmit={(qi) =>
                qi === questions.length - 1 ? submitAllQuestions() : isAnswered(qi) && goTo(qi + 1)
              }
            />
          ) : (
            <OptionList>
              <OptionRows
                options={prompt.options ?? []}
                mode={isMulti ? "checkbox" : "action"}
                shortcuts
                submittingKey={submittingKey}
                checked={(label) => answers.checked.has(label)}
                onToggle={answers.toggleChecked}
                onPick={pickOption}
              />
              {prompt.custom === true && (
                <CustomAnswerRow
                  value={answers.customText}
                  onChange={answers.setCustomText}
                  onSubmit={isMulti ? submitChecked : submitCustom}
                  placeholder={customPlaceholder}
                  disabled={submittingKey !== null}
                  sendDisabled={
                    isMulti
                      ? answers.customText.trim().length === 0 && answers.checked.size === 0
                      : answers.customText.trim().length === 0
                  }
                  busy={submittingKey === "custom" || submittingKey === "multi-submit"}
                  // Multi-select: teks ikut terkirim lewat Submit di footer.
                  showSend={!isMulti}
                />
              )}
            </OptionList>
          )}
        </div>
        {error && (
          <p className="pt-2 text-[13px] text-destructive sm:text-xs" role="alert">
            {error}
          </p>
        )}
      </CardContent>

      <QuestionFooter
        submittingKey={submittingKey}
        wizard={
          isMultiQuestion
            ? {
                isFirst: stepIdx === 0,
                isLast: answers.isLastStep,
                canNext: isAnswered(stepIdx),
                canSubmit: answers.allAnswered,
                onBack: () => goTo(stepIdx - 1),
                onNext: () => goTo(stepIdx + 1),
                onSubmit: submitAllQuestions,
              }
            : null
        }
        // Submit hanya untuk mode yang MENGUMPULKAN jawaban; single choice
        // tanpa Submit — ketuk opsi langsung menjawab.
        multiSubmit={
          isMulti
            ? {
                disabled: answers.checked.size === 0 && answers.customText.trim().length === 0,
                busy: submittingKey === "multi-submit",
                onSubmit: submitChecked,
              }
            : null
        }
        onSkip={() => submit("dismiss", "cancel")}
      />
    </Card>
  );
}
