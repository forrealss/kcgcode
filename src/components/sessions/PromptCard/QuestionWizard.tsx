/**
 * Wizard multi-question: satu pertanyaan per langkah (`QuestionWizard`) dan
 * penanda langkah di bawah header (`StepIndicator`). Jawaban dikumpulkan per
 * pertanyaan lalu dikirim sekaligus lewat footer kartu.
 */
import * as m from "motion/react-m";
import { cn } from "@/lib/utils";
import type { PromptQuestion } from "@/types";
import { CustomAnswerRow, OptionList, OptionRows } from "./OptionList";

export function QuestionWizard({
  promptId,
  questions,
  stepIdx,
  submittingKey,
  selections,
  customTexts,
  customPlaceholder,
  onPickOption,
  onCustomTextChange,
  onCustomSubmit,
}: {
  promptId: string;
  questions: PromptQuestion[];
  stepIdx: number;
  submittingKey: string | null;
  /** Label terpilih per indeks pertanyaan. */
  selections: Record<number, Set<string>>;
  /** Teks jawaban bebas per indeks pertanyaan. */
  customTexts: Record<number, string>;
  customPlaceholder: string;
  onPickOption: (qi: number, label: string, allowMulti: boolean) => void;
  onCustomTextChange: (qi: number, value: string) => void;
  /** Enter di jawaban bebas pertanyaan ke-`qi`. */
  onCustomSubmit: (qi: number) => void;
}) {
  const lastIdx = questions.length - 1;
  return (
    // Semua langkah ditumpuk di SATU sel grid: tinggi kartu = langkah
    // tertinggi dan TETAP selama navigasi. Sebelumnya hanya langkah
    // aktif yang dirender, sehingga tinggi kartu berubah tiap ganti
    // langkah — dan karena kartu docked di bawah timeline (flex),
    // timeline ikut membesar/mengecil lalu scroller menyesuaikan
    // posisi scroll: terlihat seperti kartu melebar lalu menyusut.
    // Langkah non-aktif tetap ada di layout tapi `invisible` + `inert`
    // (tidak terlihat, tidak bisa difokus, tidak dibaca screen reader).
    // `overflow-x-clip`: langkah non-aktif digeser ±24px (animasi
    // slide) sehingga melewati tepi grid. Tanpa clip, area scroll
    // kartu ikut bisa digeser horizontal. `clip` (bukan `hidden`)
    // tidak membuat scroll container baru, jadi scroll vertikal
    // tetap ditangani wadah jawaban.
    <div className="grid min-w-0 overflow-x-clip">
      {questions.map((q, qi) => {
        const active = qi === stepIdx;
        const qMulti = q.multiple === true;
        const sel = selections[qi] ?? new Set<string>();
        // Geser horizontal sesuai posisi relatif terhadap langkah aktif
        // (dimatikan bila prefers-reduced-motion — MotionConfig di App).
        const offset = qi < stepIdx ? -24 : qi > stepIdx ? 24 : 0;
        return (
          <m.section
            // biome-ignore lint/suspicious/noArrayIndexKey: daftar pertanyaan statis, state diindeks per qi
            key={`step-${qi}`}
            initial={false}
            animate={{
              opacity: active ? 1 : 0,
              x: offset,
              transition: { duration: active ? 0.2 : 0.12, ease: "easeOut" },
            }}
            inert={!active}
            aria-hidden={!active}
            aria-labelledby={`q-${promptId}-${qi}`}
            className={cn(
              "col-start-1 row-start-1 flex min-w-0 flex-col gap-2.5",
              !active && "pointer-events-none",
            )}
          >
            {/* Judul grup ala `PrefsGroup`: header kecil, pertanyaan
                sebagai judul, petunjuk sebagai deskripsi. */}
            <div className="flex flex-col gap-0.5 px-1">
              {q.header && <span className="text-[12px] text-muted-foreground">{q.header}</span>}
              <h3
                id={`q-${promptId}-${qi}`}
                className="wrap-anywhere text-[15px] leading-5 font-semibold tracking-tight"
              >
                {q.question ?? `Question ${qi + 1}`}
              </h3>
              {qMulti && <p className="text-[13px] text-muted-foreground">Select all that apply</p>}
            </div>
            <OptionList>
              <OptionRows
                options={q.options ?? []}
                mode={qMulti ? "checkbox" : "radio"}
                // Pintasan angka hanya untuk langkah aktif.
                shortcuts={active}
                submittingKey={submittingKey}
                checked={(label) => sel.has(label)}
                onToggle={(label) => onPickOption(qi, label, qMulti)}
              />
              {q.custom !== false && (
                <CustomAnswerRow
                  value={customTexts[qi] ?? ""}
                  onChange={(v) => onCustomTextChange(qi, v)}
                  // Enter: lanjut ke langkah berikutnya, atau kirim di
                  // langkah terakhir.
                  onSubmit={() => onCustomSubmit(qi)}
                  placeholder={customPlaceholder}
                  disabled={submittingKey !== null}
                  sendDisabled
                  busy={false}
                  ariaLabel={`Your own answer for question ${qi + 1}`}
                  showSend={false}
                  enterHint={qi === lastIdx ? "send" : "next"}
                />
              )}
            </OptionList>
          </m.section>
        );
      })}
    </div>
  );
}

/**
 * Penanda langkah wizard: satu segmen per pertanyaan. Segmen terisi =
 * sudah dijawab, segmen aktif lebih tebal. Tiap segmen bisa diketuk untuk
 * lompat ke pertanyaan itu (target sentuh 44px, garisnya tetap tipis).
 */
export function StepIndicator({
  count,
  current,
  answered,
  labels,
  disabled,
  onSelect,
}: {
  count: number;
  current: number;
  answered: (i: number) => boolean;
  labels: string[];
  disabled: boolean;
  onSelect: (i: number) => void;
}) {
  return (
    <nav aria-label="Questions" className="shrink-0 px-4 sm:px-5">
      <ol className="-my-2 flex gap-1.5">
        {Array.from({ length: count }, (_, i) => {
          const done = answered(i);
          const active = i === current;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: segmen statis per indeks pertanyaan
            <li key={i} className="min-w-0 flex-1">
              <button
                type="button"
                disabled={disabled}
                onClick={() => onSelect(i)}
                aria-current={active ? "step" : undefined}
                aria-label={`${labels[i]}${done ? " (answered)" : ""}`}
                className="group flex h-11 w-full touch-manipulation items-center outline-none sm:h-6"
              >
                <span
                  className={cn(
                    "h-1 w-full rounded-full transition-colors group-focus-visible:ring-[3px] group-focus-visible:ring-ring/50",
                    active
                      ? "bg-primary"
                      : done
                        ? "bg-primary/45 group-hover:bg-primary/60"
                        : "bg-muted group-hover:bg-muted-foreground/30",
                  )}
                />
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
