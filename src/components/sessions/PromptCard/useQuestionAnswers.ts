/**
 * State jawaban kartu pertanyaan (lokal, belum terkirim).
 *
 * - Pertanyaan tunggal: teks jawaban bebas + opsi tercentang (multi-select,
 *   urut klik — bukan urutan daftar).
 * - Multi-question = wizard bertahap: label terpilih & teks bebas per indeks
 *   pertanyaan, plus langkah aktif. Pertanyaan non-multiple berperilaku
 *   radio — pilihan baru menggantikan yang lama.
 *
 * State di-reset saat kartu dipakai ulang untuk prompt lain (id berganti).
 */
import { useEffect, useRef, useState } from "react";
import { collectAnswer, toggleChoice } from "@/lib/prompts";

/** Jeda auto-lanjut setelah memilih opsi single choice (pilihan sempat terlihat). */
const AUTO_ADVANCE_MS = 220;

export function useQuestionAnswers(promptId: string, questionCount: number) {
  /** Isi input jawaban bebas (pertanyaan tunggal dengan flag `custom`). */
  const [customText, setCustomText] = useState("");
  /** Multi-select pertanyaan tunggal: label opsi yang dicentang. */
  const [checked, setChecked] = useState<Set<string>>(new Set());
  /** Multi-question: label terpilih per indeks pertanyaan. */
  const [selections, setSelections] = useState<Record<number, Set<string>>>({});
  /** Multi-question: isi input jawaban bebas per indeks pertanyaan. */
  const [customTexts, setCustomTexts] = useState<Record<number, string>>({});
  /** Multi-question: langkah wizard aktif (Back / Next, Submit di akhir). */
  const [step, setStep] = useState(0);
  /** Timer auto-lanjut setelah memilih opsi single choice di wizard. */
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // promptId SATU-SATUNYA trigger reset — menghapusnya dari deps membuat
  // efek jalan tiap render dan selalu mengosongkan jawaban.
  // biome-ignore lint/correctness/useExhaustiveDependencies: promptId sengaja jadi satu-satunya trigger reset state
  useEffect(() => {
    setChecked(new Set());
    setCustomText("");
    setSelections({});
    setCustomTexts({});
    setStep(0);
    return () => clearTimeout(advanceTimer.current);
  }, [promptId]);

  /** Jawaban per pertanyaan wizard (urut daftar); array kosong = belum dijawab. */
  const stepAnswers = Array.from({ length: questionCount }, (_, qi) =>
    collectAnswer(selections[qi], customTexts[qi]),
  );
  /** Pertanyaan ke-`qi` sudah punya jawaban (opsi dan/atau teks kustom). */
  const isAnswered = (qi: number) => (stepAnswers[qi]?.length ?? 0) > 0;

  // Indeks dijaga dalam rentang (daftar pertanyaan bisa berubah).
  const stepIdx = Math.min(step, Math.max(questionCount - 1, 0));

  const goTo = (next: number) => {
    clearTimeout(advanceTimer.current);
    if (next < 0 || next >= questionCount || next === stepIdx) return;
    setStep(next);
  };

  /**
   * Pilih opsi di wizard. Pertanyaan single choice otomatis lanjut ke
   * langkah berikutnya setelah jeda singkat (pilihan sempat terlihat) —
   * kecuali di langkah terakhir, di mana user menekan Submit.
   */
  const pickStepOption = (qi: number, label: string, allowMulti: boolean) => {
    setSelections((prev) => ({ ...prev, [qi]: toggleChoice(prev[qi], label, allowMulti) }));
    if (allowMulti || qi >= questionCount - 1) return;
    clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(() => goTo(qi + 1), AUTO_ADVANCE_MS);
  };

  return {
    customText,
    setCustomText,
    checked,
    /** Toggle satu opsi multi-select (checkbox baris opsi). */
    toggleChecked: (label: string) => setChecked((prev) => toggleChoice(prev, label, true)),
    selections,
    customTexts,
    setCustomTextAt: (qi: number, v: string) => setCustomTexts((prev) => ({ ...prev, [qi]: v })),
    clearCustomTexts: () => setCustomTexts({}),
    stepAnswers,
    isAnswered,
    answeredCount: stepAnswers.filter((a) => a.length > 0).length,
    allAnswered: stepAnswers.every((a) => a.length > 0),
    stepIdx,
    isLastStep: stepIdx === questionCount - 1,
    goTo,
    pickStepOption,
  };
}
