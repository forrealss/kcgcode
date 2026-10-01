/**
 * Kartu Interactive_Prompt (Requirement 8.4, 8.5).
 *
 * - Tipe `"confirmation"`: tombol aksi cepat Approve, Always allow, Deny, dan
 *   Cancel. "Always allow" mengirim `always` — opencode mengingat pola yang
 *   disetujui sehingga request identik berikutnya tidak menampilkan kartu
 *   lagi. "Cancel" memperlakukan sebagai respon Deny yang sama (Requirement
 *   8.5 — meneruskan mengikuti mekanisme penyelesaian Requirement 6).
 * - Tipe `"menu"` (question): baris opsi ala TUI opencode — label beserta
 *   keterangan (`description` dari skema tool `question`). Single choice
 *   langsung menyelesaikan kartu saat baris diklik (`{ option }`); multi-
 *   select (`multiple: true`) memakai checkbox + footer Dismiss/Submit dan
 *   mengirim seluruh label terpilih sebagai `{ options: string[] }`. Jawaban
 *   bebas (`custom`) tetap tersedia di kedua mode.
 * - Multi-question (`questions` berisi >1 pertanyaan): SEMUA pertanyaan
 *   dirender sebagai bagian dalam satu kartu; jawaban dikumpulkan per
 *   pertanyaan lalu dikirim SEKALIGUS sebagai `{ answers: string[][] }` —
 *   satu array label per pertanyaan, urut sesuai daftar. Submit baru aktif
 *   setelah tiap pertanyaan punya minimal satu jawaban (opsi dan/atau teks
 *   kustom); Dismiss menolak seluruh request.
 * - Beberapa request permission yang identik (opencode memancarkan satu
 *   request per tool call) digroup jadi SATU kartu: `prompts` berisi seluruh
 *   anggota grup, satu set tombol, dan jawaban diteruskan ke SEMUA id —
 *   server meneruskan reply ke tiap request (fan-out).
 *
 * Feedback klik: tombol/baris yang diklik menampilkan spinner dan seluruh
 * aksi terkunci sampai `prompt_resolved` menghapus kartu. Kegagalan (WS
 * putus, server menolak) ditampilkan DI kartu via `errorSignal` — klik yang
 * gagal tidak lagi diam saja sehingga tombol terasa mati.
 *
 * Desain: panel floating di ATAS composer (ala dialog izin Claude/opencode)
 * dengan animasi masuk/keluar (Motion, di `PromptPanel`). Logika pemetaan aksi & pengelompokan prompt dipisah ke
 * `lib/prompts.ts` (fungsi murni, diuji tanpa DOM — unit test 24.6).
 */
import {
  ArrowUpIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  HelpCircleIcon,
  ListChecksIcon,
  PencilLineIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
} from "lucide-react";
import * as m from "motion/react-m";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { type PermissionRisk, parsePermissionTitle } from "@/lib/permission-info";
import { getPromptQuestions } from "@/lib/prompts";
import { cn } from "@/lib/utils";
import type { InteractivePrompt, PromptOption, PromptResponse } from "@/types";

export interface PromptCardProps {
  /**
   * Grup prompt yang tampil sebagai satu kartu — minimal satu elemen.
   * Anggota identik (kind + title sama): permission bertumpuk dari opencode.
   */
  prompts: InteractivePrompt[];
  /** Dipanggil dengan respon pengguna untuk tiap id anggota (Req 6.3, 6.7). */
  onResolve: (promptId: string, response: PromptResponse) => void;
  /**
   * Error resolusi terbaru dari server (WS `error` berkode PROMPT_*).
   * `null` = tidak ada. Non-null -> tampil sebagai error kartu, lalu
   * dikonsumsi via `onConsumeError` agar tidak muncul lagi di render lain.
   */
  errorSignal?: string | null;
  /** Reset `errorSignal` di pemilik state setelah kartu menampilkannya. */
  onConsumeError?: () => void;
  /**
   * `true` = kartu docked di dasar MENGGANTIKAN composer (question pending):
   * mengisi sisa tinggi kolom dan hanya area jawaban yang scroll — header
   * pertanyaan dan footer aksi (Dismiss/Submit) selalu terlihat. `false` =
   * kartu mengambang di atas composer (ukuran alami, tanpa scroll internal).
   */
  docked?: boolean;
}

export function PromptCard({
  prompts,
  onResolve,
  errorSignal,
  onConsumeError,
  docked = false,
}: PromptCardProps) {
  const prompt = prompts[0];
  /** Key aksi yang diklik — spinner pada tombol itu, tombol lain terkunci. */
  const [submittingKey, setSubmittingKey] = useState<string | null>(null);
  /** Kunci kirim sinkron — mencegah balasan ganda dari klik beruntun cepat. */
  const sendingRef = useRef(false);
  /** Pesan error klik TERAKHIR — tampil di kartu, bukan di atas chat. */
  const [error, setError] = useState<string | null>(null);
  /** Isi input jawaban bebas (question dengan flag `custom`). */
  const [customValue, setCustomValue] = useState("");
  /** Multi-select: label opsi yang dicentang (urut klik, bukan urutan daftar). */
  const [selectedMulti, setSelectedMulti] = useState<Set<string>>(new Set());
  /**
   * Multi-question: label terpilih per indeks pertanyaan. Pertanyaan non-
   * multiple berperilaku radio — pilihan baru menggantikan yang lama.
   */
  const [multiSel, setMultiSel] = useState<Record<number, Set<string>>>({});
  /** Multi-question: isi input jawaban bebas per indeks pertanyaan. */
  const [customValues, setCustomValues] = useState<Record<number, string>>({});
  /**
   * Multi-question = wizard bertahap: satu pertanyaan per langkah dengan
   * Back / Next, dan Submit di langkah terakhir.
   */
  const [step, setStep] = useState(0);
  /** Timer auto-lanjut setelah memilih opsi single choice di wizard. */
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Error server (PROMPT_NOT_FOUND / PROMPT_ALREADY_RESOLVED) -> tampil di
  // kartu, lalu sinyal dikonsumsi supaya tidak muncul di kartu lain.
  useEffect(() => {
    if (errorSignal) {
      sendingRef.current = false;
      setSubmittingKey(null);
      setError(errorSignal);
      onConsumeError?.();
    }
  }, [errorSignal, onConsumeError]);

  // Kartu dipakai ulang untuk grup prompt berbeda (prompt.id berganti) —
  // reset state lokal agar tidak membawa pilihan kartu sebelumnya.
  // prompt?.id SATU-SATUNYA trigger reset — menghapusnya dari deps membuat
  // efek jalan tiap render dan selalu mengosongkan jawaban.
  // biome-ignore lint/correctness/useExhaustiveDependencies: prompt?.id sengaja jadi satu-satunya trigger reset state
  useEffect(() => {
    setSelectedMulti(new Set());
    setCustomValue("");
    setMultiSel({});
    setCustomValues({});
    setStep(0);
    sendingRef.current = false;
    setSubmittingKey(null);
    setError(null);
    return () => clearTimeout(advanceTimer.current);
  }, [prompt?.id]);

  /**
   * Pintasan keyboard question (desktop): angka 1–9 memilih opsi ke-n.
   * Handler terbaru disimpan di ref agar listener cukup dipasang sekali.
   */
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandlerRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!prompt) return null;
  const isMenu = prompt.type === "menu";
  const isPermission = prompt.kind === "permission";
  // Question multi-select: jawaban dikumpulkan lewat checkbox lalu dikirim
  // sekaligus — bukan satu klik per opsi.
  const isMulti = isMenu && prompt.multiple === true;
  // Multi-question: seluruh pertanyaan request dirender dalam satu kartu.
  const questions = getPromptQuestions(prompt);
  const isMultiQuestion = isMenu && questions.length > 1;
  // Permission identik yang menumpuk di server — beri tahu user bahwa satu
  // klik menjawab semuanya.
  const twinCount = prompts.length;

  const resolveResponse = (key: string, response: PromptResponse) => {
    // Kunci SINKRON (ref), bukan state: klik beruntun cepat terjadi sebelum
    // React me-render ulang, sehingga `submittingKey` dari closure masih
    // null dan tiap klik lolos -> balasan ganda ke opencode.
    if (sendingRef.current) return;
    sendingRef.current = true;
    setError(null);
    setSubmittingKey(key);
    try {
      for (const p of prompts) onResolve(p.id, response);
    } catch (e) {
      // Gagal kirim (WS putus dsb.) — pesan error di kartu, tombol aktif lagi.
      sendingRef.current = false;
      setSubmittingKey(null);
      setError(e instanceof Error ? e.message : "Failed to send the response.");
    }
  };

  /** Kirim jawaban bebas dari input kustom (bentuk respon sama dengan opsi). */
  const submitCustom = () => {
    const text = customValue.trim();
    if (text.length === 0) return;
    setCustomValue("");
    resolveResponse("custom", { option: text });
  };

  /** Toggle satu opsi multi-select (checkbox baris opsi). */
  const toggleMulti = (label: string) => {
    setSelectedMulti((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  /**
   * Kirim jawaban multi-select: seluruh opsi tercentang (+ teks kustom bila
   * diisi) sebagai satu array label — bentuk respon `{ options: string[] }`.
   */
  const submitMulti = (extra?: string) => {
    const labels = [...selectedMulti];
    const text = extra?.trim() ?? "";
    if (text.length > 0) labels.push(text);
    if (labels.length === 0) return;
    setCustomValue("");
    resolveResponse("multi-submit", { options: labels });
  };

  /** Toggle opsi pada pertanyaan ke-`qi` dalam kartu multi-question. */
  const toggleQOption = (qi: number, label: string, allowMulti: boolean) => {
    setMultiSel((prev) => {
      const cur = new Set(prev[qi] ?? []);
      if (allowMulti) {
        if (cur.has(label)) cur.delete(label);
        else cur.add(label);
      } else {
        // Pertanyaan single choice dalam batch: pilihan baru menggantikan.
        cur.clear();
        cur.add(label);
      }
      return { ...prev, [qi]: cur };
    });
  };

  /**
   * Kirim jawaban multi-question: SATU array label per pertanyaan (urut
   * daftar). Semua pertanyaan wajib terjawab (opsi dan/atau teks kustom) —
   * opencode menuntut jawaban per pertanyaan; menolak sebagian = Dismiss.
   */
  const submitMultiQuestion = () => {
    const answers = questions.map((_, qi) => {
      const labels = [...(multiSel[qi] ?? [])];
      const text = (customValues[qi] ?? "").trim();
      if (text.length > 0) labels.push(text);
      return labels;
    });
    if (answers.some((a) => a.length === 0)) return;
    setCustomValues({});
    resolveResponse("multi-question", { answers });
  };

  /** Semua pertanyaan multi-question sudah punya minimal satu jawaban. */
  const allQuestionsAnswered = questions.every(
    (_q, qi) => (multiSel[qi]?.size ?? 0) > 0 || (customValues[qi] ?? "").trim().length > 0,
  );

  /**
   * Baris opsi question (boxed list ala libadwaita):
   * - `action`   : single choice — ketuk baris langsung menjawab.
   * - `radio`    : single choice dalam multi-question — memilih, dikirim lewat
   *                Submit.
   * - `checkbox` : multi-select — centang beberapa, dikirim lewat Submit.
   * Baris minimal 52px di HP (target sentuh nyaman), 44px di desktop.
   */
  const optionRows = (
    opts: PromptOption[],
    optsKey: string,
    mode: "action" | "radio" | "checkbox",
    checked: (label: string) => boolean,
    onToggle: (label: string) => void,
    onPick: (label: string) => void,
  ) =>
    opts.map((opt, i) => {
      const isChecked = mode !== "action" && checked(opt.label);
      const busy = mode === "action" && submittingKey === `option-${opt.label}`;
      const disabled = submittingKey !== null;
      // Pintasan angka hanya untuk daftar opsi utama (bukan multi-question).
      const shortcut =
        (optsKey === "single" || optsKey.startsWith("step")) && i < 9 ? String(i + 1) : undefined;
      return (
        <li key={`${optsKey}-${opt.label}`}>
          <button
            type="button"
            role={mode === "checkbox" ? "checkbox" : mode === "radio" ? "radio" : undefined}
            {...(mode !== "action" ? { "aria-checked": isChecked } : {})}
            aria-busy={busy}
            aria-keyshortcuts={shortcut}
            disabled={disabled}
            onClick={() => (mode === "action" ? onPick(opt.label) : onToggle(opt.label))}
            className={cn(
              // Baris boxed list ala `ActionRow` (settings/prefs.tsx): 56px,
              // px-4, hover/active muted, ring inset. `touch-manipulation`
              // menghapus jeda tap di HP.
              "flex min-h-14 w-full touch-manipulation items-center gap-3 px-4 py-2.5 text-left transition-colors outline-none",
              "hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:ring-inset active:bg-muted",
              disabled && !busy && "pointer-events-none opacity-50",
            )}
          >
            {mode === "checkbox" && (
              <span
                aria-hidden
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors sm:size-4.5",
                  isChecked
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted-foreground/45",
                )}
              >
                {isChecked && <CheckIcon className="size-3" strokeWidth={3} />}
              </span>
            )}
            {mode === "radio" && (
              <span
                aria-hidden
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors sm:size-4.5",
                  isChecked ? "border-primary bg-primary" : "border-muted-foreground/45",
                )}
              >
                {isChecked && <span className="size-1.5 rounded-full bg-primary-foreground" />}
              </span>
            )}
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-0.5">
              <span className="wrap-anywhere text-[15px] leading-5">{opt.label}</span>
              {opt.description && (
                <span className="wrap-anywhere text-[13px] leading-snug text-muted-foreground">
                  {opt.description}
                </span>
              )}
            </span>
            {/* Suffix ala AdwActionRow: chevron untuk baris yang langsung
              menjawab; spinner saat terkirim. Pintasan angka sebagai
              keycap kecil, hanya di desktop. */}
            {mode === "action" && (
              <span className="flex shrink-0 items-center gap-2">
                {shortcut && (
                  <kbd
                    aria-hidden
                    className="hidden rounded border px-1.5 font-mono text-[11px] leading-5 text-muted-foreground sm:inline"
                  >
                    {shortcut}
                  </kbd>
                )}
                {busy ? (
                  <Spinner className="size-4" />
                ) : (
                  <ChevronRightIcon aria-hidden className="size-4 text-muted-foreground" />
                )}
              </span>
            )}
          </button>
        </li>
      );
    });

  /**
   * Input jawaban bebas. Enter mengirim sesuai mode kartu. `showSend: false`
   * = jawaban ikut terkirim lewat Submit di footer (multi-question /
   * multi-select), jadi tombol kirim per baris disembunyikan.
   * Font 16px di HP: iOS Safari tidak men-zoom halaman saat input difokus.
   */
  const customInput = (opts: {
    value: string;
    onChange: (v: string) => void;
    onSubmit: () => void;
    sendDisabled: boolean;
    busy: boolean;
    ariaLabel?: string;
    showSend?: boolean;
    enterHint?: "send" | "next";
  }) => (
    // Baris ala `EntryRow` (settings/prefs.tsx): tinggal di DALAM boxed list
    // opsi sebagai baris terakhir, label kecil di atas input; tombol kirim
    // bulat muncul begitu ada isi.
    <li>
      <label className="flex min-h-14 cursor-text items-center gap-3 px-4 py-2 focus-within:bg-muted/30">
        <PencilLineIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[12px] leading-4 text-muted-foreground">Other</span>
          <input
            value={opts.value}
            onChange={(e) => opts.onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                opts.onSubmit();
              }
            }}
            placeholder="Type your own answer…"
            disabled={submittingKey !== null}
            aria-label={opts.ariaLabel ?? "Your own answer"}
            enterKeyHint={opts.enterHint ?? (opts.showSend === false ? "next" : "send")}
            // 16px di HP: iOS Safari tidak men-zoom saat input difokus.
            className="h-7 w-full min-w-0 bg-transparent text-base outline-none placeholder:text-muted-foreground/70 disabled:opacity-60 sm:text-[15px]"
          />
        </span>
        {opts.showSend !== false && (
          <button
            type="button"
            disabled={submittingKey !== null || opts.sendDisabled}
            aria-busy={opts.busy}
            aria-label="Send your answer"
            onClick={opts.onSubmit}
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xs transition-opacity outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-0 sm:size-8",
              opts.busy && "disabled:opacity-60",
            )}
          >
            {opts.busy ? <Spinner className="size-4" /> : <ArrowUpIcon className="size-4" />}
          </button>
        )}
      </label>
    </li>
  );

  // Izin tool punya kartu sendiri: penjelasan ramah + aksi yang jelas
  // konsekuensinya (lihat `PermissionCard`).
  if (isPermission) {
    return (
      <PermissionCard
        prompt={prompt}
        twinCount={twinCount}
        submittingKey={submittingKey}
        error={error}
        onResolve={resolveResponse}
      />
    );
  }

  // ---- Question ----------------------------------------------------------
  /** Pertanyaan ke-`qi` sudah punya jawaban (opsi dan/atau teks kustom). */
  const isAnswered = (qi: number) =>
    (multiSel[qi]?.size ?? 0) > 0 || (customValues[qi] ?? "").trim().length > 0;
  const answeredCount = questions.filter((_q, qi) => isAnswered(qi)).length;

  // Wizard multi-question: indeks dijaga dalam rentang (daftar bisa berubah).
  const stepIdx = Math.min(step, Math.max(questions.length - 1, 0));
  const isLastStep = stepIdx === questions.length - 1;
  const goTo = (next: number) => {
    clearTimeout(advanceTimer.current);
    if (next < 0 || next >= questions.length || next === stepIdx) return;
    setStep(next);
  };

  /**
   * Pilih opsi di wizard. Pertanyaan single choice otomatis lanjut ke
   * langkah berikutnya setelah jeda singkat (pilihan sempat terlihat) —
   * kecuali di langkah terakhir, di mana user menekan Submit.
   */
  const pickStepOption = (qi: number, label: string, allowMulti: boolean) => {
    toggleQOption(qi, label, allowMulti);
    if (allowMulti || qi >= questions.length - 1) return;
    clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(() => goTo(qi + 1), 220);
  };

  // Aksi footer: Submit hanya untuk mode yang MENGUMPULKAN jawaban (multi-
  // select / multi-question). Single choice tanpa Submit — ketuk opsi
  // langsung menjawab.
  const footer = isMulti
    ? {
        submitDisabled: selectedMulti.size === 0 && customValue.trim().length === 0,
        busy: submittingKey === "multi-submit",
        onSubmit: () => submitMulti(customValue),
      }
    : null;

  const hint = isMulti ? "Select all that apply" : "Tap an option to answer";

  // Pintasan keyboard (desktop), diabaikan saat mengetik / ada modifier:
  // - Angka 1–9 = pilih opsi ke-n (single: jawab / lanjut; multi: toggle).
  // - Wizard: ← / → = langkah sebelumnya / berikutnya.
  keyHandlerRef.current = (e) => {
    if (submittingKey !== null || e.defaultPrevented || e.isComposing) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
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
      pickStepOption(stepIdx, opt.label, q.multiple === true);
      return;
    }
    const opt = (prompt.options ?? [])[n];
    if (!opt) return;
    e.preventDefault();
    if (isMulti) toggleMulti(opt.label);
    else resolveResponse(`option-${opt.label}`, { option: opt.label });
  };

  const optionCount = isMultiQuestion
    ? (questions[stepIdx]?.options?.length ?? 0)
    : (prompt.options?.length ?? 0);

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
      {/* Header: judul = PERTANYAAN itu sendiri (bukan label "Question").
          Pertanyaan sangat panjang dibatasi tingginya (scroll sendiri) agar
          opsi tetap kelihatan di layar HP. */}
      <CardHeader className="flex max-h-[30dvh] shrink-0 flex-row items-start gap-3 overflow-y-auto px-5 pt-4 pb-3">
        <span
          aria-hidden
          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-foreground/80"
        >
          {isMultiQuestion || isMulti ? (
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
              ? `The agent has ${questions.length} questions`
              : (prompt.title ?? "The agent has a question")}
          </CardTitle>
          <CardDescription className="flex items-center gap-1.5 text-[13px]">
            {submittingKey !== null ? (
              <>
                <Spinner className="size-3" />
                Sending…
              </>
            ) : isMultiQuestion ? (
              `Question ${stepIdx + 1} of ${questions.length} · ${answeredCount} answered`
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
          {isMultiQuestion ? (
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
                const sel = multiSel[qi] ?? new Set<string>();
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
                    aria-labelledby={`q-${prompt.id}-${qi}`}
                    className={cn(
                      "col-start-1 row-start-1 flex min-w-0 flex-col gap-2.5",
                      !active && "pointer-events-none",
                    )}
                  >
                    {/* Judul grup ala `PrefsGroup`: header kecil, pertanyaan
                        sebagai judul, petunjuk sebagai deskripsi. */}
                    <div className="flex flex-col gap-0.5 px-1">
                      {q.header && (
                        <span className="text-[12px] text-muted-foreground">{q.header}</span>
                      )}
                      <h3
                        id={`q-${prompt.id}-${qi}`}
                        className="wrap-anywhere text-[15px] leading-5 font-semibold tracking-tight"
                      >
                        {q.question ?? `Question ${qi + 1}`}
                      </h3>
                      {qMulti && (
                        <p className="text-[13px] text-muted-foreground">Select all that apply</p>
                      )}
                    </div>
                    <OptionList>
                      {optionRows(
                        q.options ?? [],
                        // Pintasan angka hanya untuk langkah aktif.
                        active ? `step${qi}` : `hidden${qi}`,
                        qMulti ? "checkbox" : "radio",
                        (label) => sel.has(label),
                        (label) => pickStepOption(qi, label, qMulti),
                        () => {},
                      )}
                      {q.custom !== false &&
                        customInput({
                          value: customValues[qi] ?? "",
                          onChange: (v) => setCustomValues((prev) => ({ ...prev, [qi]: v })),
                          // Enter: lanjut ke langkah berikutnya, atau kirim
                          // di langkah terakhir.
                          onSubmit: () =>
                            qi === questions.length - 1
                              ? submitMultiQuestion()
                              : isAnswered(qi) && goTo(qi + 1),
                          sendDisabled: true,
                          busy: false,
                          ariaLabel: `Your own answer for question ${qi + 1}`,
                          showSend: false,
                          enterHint: qi === questions.length - 1 ? "send" : "next",
                        })}
                    </OptionList>
                  </m.section>
                );
              })}
            </div>
          ) : (
            <OptionList>
              {optionRows(
                prompt.options ?? [],
                "single",
                isMulti ? "checkbox" : "action",
                (label) => selectedMulti.has(label),
                toggleMulti,
                (label) => resolveResponse(`option-${label}`, { option: label }),
              )}
              {prompt.custom === true &&
                customInput({
                  value: customValue,
                  onChange: setCustomValue,
                  onSubmit: () => (isMulti ? submitMulti(customValue) : submitCustom()),
                  sendDisabled: isMulti
                    ? customValue.trim().length === 0 && selectedMulti.size === 0
                    : customValue.trim().length === 0,
                  busy: submittingKey === "custom" || submittingKey === "multi-submit",
                  // Multi-select: teks ikut terkirim lewat Submit di footer.
                  showSend: !isMulti,
                })}
            </OptionList>
          )}
        </div>
        {error && (
          <p className="pt-2 text-[13px] text-destructive sm:text-xs" role="alert">
            {error}
          </p>
        )}
      </CardContent>

      {/* Footer selalu di luar area scroll.
          - Wizard: Skip | Back · Next/Submit answers.
          - Multi-select: Skip | Submit.
          - Single choice: hanya Skip (ketuk opsi langsung menjawab). */}
      <div
        className={cn(
          "flex shrink-0 items-center gap-2 px-3 pt-1 pb-3 sm:px-4",
          footer === null && !isMultiQuestion && "justify-end",
        )}
      >
        <Button
          type="button"
          variant={isMultiQuestion ? "ghost" : "secondary"}
          disabled={submittingKey !== null}
          aria-busy={submittingKey === "dismiss"}
          onClick={() => resolveResponse("dismiss", "cancel")}
          className={cn(
            "h-11 rounded-full px-5 text-[15px] sm:h-9 sm:text-sm",
            isMultiQuestion && "px-3 text-muted-foreground hover:text-foreground sm:px-4",
            footer !== null && "flex-1 sm:flex-none",
          )}
        >
          {submittingKey === "dismiss" && <Spinner className="size-4" data-icon="inline-start" />}
          Skip
        </Button>
        {isMultiQuestion && (
          <div className="ms-auto flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={submittingKey !== null || stepIdx === 0}
              onClick={() => goTo(stepIdx - 1)}
              aria-label="Previous question"
              aria-keyshortcuts="ArrowLeft"
              className="h-11 rounded-full px-4 text-[15px] sm:h-9 sm:text-sm"
            >
              <ChevronLeftIcon className="size-4" data-icon="inline-start" />
              <span className="hidden sm:inline">Back</span>
            </Button>
            {isLastStep ? (
              <Button
                type="button"
                disabled={submittingKey !== null || !allQuestionsAnswered}
                aria-busy={submittingKey === "multi-question"}
                onClick={submitMultiQuestion}
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
                disabled={submittingKey !== null || !isAnswered(stepIdx)}
                onClick={() => goTo(stepIdx + 1)}
                aria-keyshortcuts="ArrowRight"
                className="h-11 rounded-full px-5 text-[15px] sm:h-9 sm:text-sm"
              >
                Next
                <ChevronRightIcon className="size-4" data-icon="inline-end" />
              </Button>
            )}
          </div>
        )}
        {footer && (
          <Button
            type="button"
            disabled={submittingKey !== null || footer.submitDisabled}
            aria-busy={footer.busy}
            onClick={footer.onSubmit}
            className="h-11 flex-[2] rounded-full px-5 text-[15px] sm:ms-auto sm:h-9 sm:flex-none sm:text-sm"
          >
            {footer.busy && <Spinner className="size-4" data-icon="inline-start" />}
            Submit
          </Button>
        )}
      </div>
    </Card>
  );
}

/**
 * Penanda langkah wizard: satu segmen per pertanyaan. Segmen terisi =
 * sudah dijawab, segmen aktif lebih tebal. Tiap segmen bisa diketuk untuk
 * lompat ke pertanyaan itu (target sentuh 44px, garisnya tetap tipis).
 */
function StepIndicator({
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

/** Daftar opsi bergaya boxed list (kotak membulat, baris berpemisah). */
function OptionList({ children }: { children: ReactNode }) {
  // Sama dengan isi `PrefsGroup` (settings/prefs.tsx): kartu membulat,
  // baris berpemisah, latar card.
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <ul className="flex flex-col divide-y">{children}</ul>
    </div>
  );
}

// -------------------------------------------------------- permission ----

/**
 * Tingkat risiko hanya diwakili ikon + label teks (bukan garis/warna
 * dekoratif) — tetap sederhana ala libadwaita, dan tidak bergantung pada
 * warna saja.
 */
const RISK_STYLE: Record<PermissionRisk, { icon: string; label: string }> = {
  high: { icon: "bg-amber-500/15 text-amber-600 dark:text-amber-400", label: "Review carefully" },
  medium: { icon: "bg-muted text-foreground/80", label: "" },
  low: { icon: "bg-muted text-muted-foreground", label: "Read-only" },
};

/**
 * Kartu izin tool.
 *
 * - Judul = KALIMAT apa yang diminta ("Access a folder outside the
 *   project"), nama permission internal jadi label kecil.
 * - Target (path/perintah) tampil sebagai daftar monospace yang terbaca.
 * - Aksi menurut konsekuensi: "Allow once" (utama) & "Deny"; "Always allow"
 *   terpisah karena efeknya permanen untuk sesi ini. "Cancel" dihapus —
 *   identik dengan Deny (Req 8.5).
 * - Pintasan keyboard: Enter = izinkan sekali, Esc = tolak.
 *
 * Responsif:
 * - Desktop: satu baris aksi ringkas, tombol kecil + petunjuk pintasan.
 * - HP: teks lebih besar & tombol setinggi target sentuh (44px+), disusun
 *   vertikal selebar kartu dengan aksi utama di ATAS (paling dekat ibu jari
 *   saat kartu di atas composer).
 */
function PermissionCard({
  prompt,
  twinCount,
  submittingKey,
  error,
  onResolve,
}: {
  prompt: InteractivePrompt;
  twinCount: number;
  submittingKey: string | null;
  error: string | null;
  onResolve: (key: string, response: PromptResponse) => void;
}) {
  const info = parsePermissionTitle(prompt.title);
  const style = RISK_STYLE[info.risk];
  const busy = submittingKey !== null;

  // Enter = allow once, Esc = deny — hanya saat fokus TIDAK di kolom isian
  // (composer / input lain), agar mengetik tidak menyetujui izin tanpa sengaja.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (busy || e.defaultPrevented || e.isComposing) return;
      const el = e.target as HTMLElement | null;
      const typing =
        el !== null &&
        (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (typing) return;
      if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        onResolve("approve", "approve");
      } else if (e.key === "Escape") {
        e.preventDefault();
        onResolve("deny", "deny");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onResolve]);

  const spin = (key: string) =>
    submittingKey === key ? <Spinner className="size-4" data-icon="inline-start" /> : null;

  /** Tombol: tinggi sentuh di HP, ringkas di desktop. */
  const btn = "h-11 w-full text-[15px] sm:h-8 sm:w-auto sm:text-sm";

  return (
    <Card
      role="alertdialog"
      aria-labelledby={`perm-${prompt.id}-title`}
      aria-describedby={`perm-${prompt.id}-targets`}
      className="gap-4 rounded-2xl border bg-card py-4 shadow-lg sm:gap-3 sm:rounded-xl sm:py-3.5"
    >
      <CardHeader className="flex flex-row items-start gap-3 px-4">
        <span
          aria-hidden
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full sm:size-8",
            style.icon,
          )}
        >
          <ShieldAlertIcon className="size-5 sm:size-4.5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1 sm:gap-0.5">
          <CardTitle
            id={`perm-${prompt.id}-title`}
            className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base leading-6 sm:text-sm sm:leading-5"
          >
            <span>{info.label}</span>
            {twinCount > 1 && (
              <Badge variant="secondary" title={`${twinCount} identical requests`}>
                ×{twinCount}
              </Badge>
            )}
          </CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-x-1.5 text-[13px] sm:text-xs">
            <span>The agent is asking for permission</span>
            {info.permission && (
              <>
                <span aria-hidden>·</span>
                <code className="font-mono text-[12px] sm:text-[11px]">{info.permission}</code>
              </>
            )}
            {style.label && (
              <>
                <span aria-hidden>·</span>
                <span
                  className={cn(
                    info.risk === "high" && "font-medium text-amber-700 dark:text-amber-400",
                  )}
                >
                  {style.label}
                </span>
              </>
            )}
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4 px-4 sm:gap-3">
        {info.targets.length > 0 && (
          <ul
            id={`perm-${prompt.id}-targets`}
            className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-xl bg-muted/60 px-3 py-2.5 [scrollbar-width:thin] sm:max-h-32 sm:rounded-lg sm:py-2"
          >
            {info.targets.map((t) => (
              // wrap-anywhere: path panjang tanpa spasi tidak meluapkan kartu.
              <li
                key={t}
                className="wrap-anywhere font-mono text-[13px] leading-relaxed text-foreground/90 sm:text-xs"
              >
                {t}
              </li>
            ))}
          </ul>
        )}

        {/* HP: tombol penuh lebar bertumpuk, aksi utama di atas. Desktop:
            satu baris — "Always allow" di kiri, Deny & Allow once di kanan. */}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Button
            type="button"
            size="sm"
            disabled={busy}
            aria-busy={submittingKey === "approve"}
            onClick={() => onResolve("approve", "approve")}
            aria-keyshortcuts="Enter"
            className={cn(btn, "sm:order-3")}
          >
            {spin("approve")}
            Allow once
            <Kbd>↵</Kbd>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            aria-busy={submittingKey === "deny"}
            onClick={() => onResolve("deny", "deny")}
            aria-keyshortcuts="Escape"
            className={cn(btn, "sm:order-2 sm:ms-auto")}
          >
            {spin("deny")}
            Deny
            <Kbd>Esc</Kbd>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            aria-busy={submittingKey === "always"}
            onClick={() => onResolve("always", "always")}
            title="Don't ask again for matching requests in this session"
            className={cn(btn, "text-muted-foreground hover:text-foreground sm:order-1")}
          >
            {spin("always") ?? <ShieldCheckIcon className="size-4" data-icon="inline-start" />}
            Always allow
          </Button>
        </div>

        {error && (
          <p className="text-[13px] text-destructive sm:text-xs" role="alert">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Petunjuk pintasan kecil di dalam tombol (disembunyikan di layar sentuh). */
function Kbd({ children }: { children: string }) {
  return (
    <kbd
      aria-hidden
      className="ms-0.5 hidden rounded border border-current/20 px-1 font-sans text-[10px] leading-4 opacity-60 sm:inline"
    >
      {children}
    </kbd>
  );
}
