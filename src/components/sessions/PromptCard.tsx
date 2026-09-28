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
 * dengan animasi masuk slide-up + fade + zoom kecil (`animate-in` dari
 * tw-animate-css). Logika pemetaan aksi & pengelompokan prompt dipisah ke
 * `lib/prompts.ts` (fungsi murni, diuji tanpa DOM — unit test 24.6).
 */
import {
  CheckIcon,
  CornerDownLeftIcon,
  HelpCircleIcon,
  ListChecksIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { getPromptActions, getPromptQuestions, type PromptAction } from "@/lib/prompts";
import { cn } from "@/lib/utils";
import type { InteractivePrompt, PromptOption, PromptResponse } from "@/types";

/** Ikon aksi khusus (map nama -> komponen; nama dijaga di `lib/prompts.ts`). */
const PROMPT_ACTION_ICONS: Partial<Record<PromptAction["icon"] & string, typeof ShieldCheckIcon>> =
  {
    "shield-check": ShieldCheckIcon,
  };

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
   * `true` = jawaban sudah diterima server — kartu memainkan animasi keluar
   * (slide-down + fade) sebelum dihapus dari daftar oleh pemilik state.
   */
  exiting?: boolean;
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
  exiting = false,
  docked = false,
}: PromptCardProps) {
  const prompt = prompts[0];
  /** Key aksi yang diklik — spinner pada tombol itu, tombol lain terkunci. */
  const [submittingKey, setSubmittingKey] = useState<string | null>(null);
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

  // Error server (PROMPT_NOT_FOUND / PROMPT_ALREADY_RESOLVED) -> tampil di
  // kartu, lalu sinyal dikonsumsi supaya tidak muncul di kartu lain.
  useEffect(() => {
    if (errorSignal) {
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
    setSubmittingKey(null);
    setError(null);
  }, [prompt?.id]);

  if (!prompt) return null;
  const actions = getPromptActions(prompt);
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
    if (submittingKey !== null) return;
    setError(null);
    setSubmittingKey(key);
    try {
      for (const p of prompts) onResolve(p.id, response);
    } catch (e) {
      // Gagal kirim (WS putus dsb.) — pesan error di kartu, tombol aktif lagi.
      setSubmittingKey(null);
      setError(e instanceof Error ? e.message : "Failed to send the response.");
    }
  };

  const resolveAll = (action: PromptAction) => resolveResponse(action.key, action.response);

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
   * Baris opsi question: label + keterangan. Mode checkbox (multi) menandai
   * pilihan; mode single choice langsung menyelesaikan kartu saat diklik.
   */
  const optionRows = (
    opts: PromptOption[],
    optsKey: string,
    checkbox: boolean,
    checked: (label: string) => boolean,
    onToggle: (label: string) => void,
    onPick: (label: string) => void,
  ) =>
    opts.map((opt) => {
      const isChecked = checkbox && checked(opt.label);
      // Single choice: klik baris langsung menjawab — spinner di baris itu.
      const busy = !checkbox && submittingKey === `option-${opt.label}`;
      const disabled = submittingKey !== null;
      return (
        <button
          key={`${optsKey}-${opt.label}`}
          type="button"
          role={checkbox ? "checkbox" : "button"}
          {...(checkbox ? { "aria-checked": isChecked } : {})}
          aria-busy={busy}
          disabled={disabled}
          onClick={() => (checkbox ? onToggle(opt.label) : onPick(opt.label))}
          className={cn(
            "flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors",
            isChecked
              ? "border-primary/50 bg-primary/10"
              : "border-border/60 bg-background/40 hover:border-primary/40 hover:bg-muted/40",
            disabled && "cursor-default opacity-60",
          )}
        >
          {checkbox && (
            <span
              className={cn(
                "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border",
                isChecked ? "border-primary bg-primary text-primary-foreground" : "border-border",
              )}
            >
              {isChecked && <CheckIcon className="size-3" />}
            </span>
          )}
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-medium text-foreground">{opt.label}</span>
            {opt.description && (
              <span className="text-xs text-muted-foreground">{opt.description}</span>
            )}
          </span>
          {busy && <Spinner className="ml-auto size-3.5 self-center" />}
        </button>
      );
    });

  /** Input jawaban bebas — Enter mengirim sesuai mode kartu. */
  const customInput = (opts: {
    value: string;
    onChange: (v: string) => void;
    onSubmit: () => void;
    sendDisabled: boolean;
    busy: boolean;
    ariaLabel?: string;
  }) => (
    <div className="flex items-center gap-1.5">
      <Input
        value={opts.value}
        onChange={(e) => opts.onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            opts.onSubmit();
          }
        }}
        placeholder="Or type your own answer…"
        disabled={submittingKey !== null}
        aria-label={opts.ariaLabel ?? "Custom answer"}
        className="h-8 flex-1 bg-background/60 text-xs"
      />
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        disabled={submittingKey !== null || opts.sendDisabled}
        aria-busy={opts.busy}
        aria-label="Send custom answer"
        onClick={opts.onSubmit}
      >
        {opts.busy ? <Spinner className="size-3.5" /> : <CornerDownLeftIcon className="size-3.5" />}
      </Button>
    </div>
  );

  /** Footer Dismiss (tolak request) + Submit (kirim jawaban terkumpul). */
  const dismissSubmitFooter = (opts: {
    submitDisabled: boolean;
    busy: boolean;
    onSubmit: () => void;
  }) => (
    // Docked: footer di LUAR area scroll (tetap terlihat saat jawaban panjang)
    // — saat docked, pemanggil me-render hasil helper ini terpisah.
    <div className="flex items-center justify-between gap-2 pt-0.5">
      {/* Dismiss = tolak pertanyaan tanpa jawaban (respon "cancel",
            sama dengan rejectQuestion di sisi server). */}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={submittingKey !== null}
        onClick={() => resolveResponse("dismiss", "cancel")}
      >
        Dismiss
      </Button>
      <Button
        type="button"
        size="sm"
        disabled={submittingKey !== null || opts.submitDisabled}
        aria-busy={opts.busy}
        onClick={opts.onSubmit}
      >
        {opts.busy && <Spinner className="size-3.5" data-icon="inline-start" />}
        Submit
      </Button>
    </div>
  );

  return (
    <Card
      className={cn(
        // Animasi masuk: naik dari bawah + fade + sedikit membesar (ala
        // dialog izin) — tw-animate-css sudah dimuat di globals.css.
        "animate-in fade-in-0 slide-in-from-bottom-6 zoom-in-95 duration-400",
        // Animasi keluar: turun ke bawah + fade (jawaban diterima server).
        exiting && "animate-out fade-out-0 slide-out-to-bottom-4 zoom-out-95 duration-200",
        "gap-3 rounded-xl border-border/70 bg-card/95 py-3.5 shadow-lg shadow-black/20 ring-1 ring-foreground/5 backdrop-blur-md",
        // Docked (menggantikan composer): kartu mengisi sisa kolom; konten
        // dalam CardContent diatur flex agar hanya jawaban yang scroll.
        docked && "flex min-h-0 flex-1 flex-col overflow-hidden",
      )}
    >
      <CardHeader className="flex flex-row items-center gap-3">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full",
            isPermission ? "bg-amber-500/15 text-amber-500" : "bg-primary/15 text-primary",
          )}
        >
          {isPermission ? (
            <ShieldAlertIcon className="size-4.5" />
          ) : isMenu ? (
            <ListChecksIcon className="size-4.5" />
          ) : (
            <HelpCircleIcon className="size-4.5" />
          )}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <CardTitle className="flex items-center gap-2 text-sm">
            {isPermission ? "Tool permission" : isMenu ? "Question" : "Interactive Prompt"}
            {isMultiQuestion && <Badge variant="secondary">{questions.length} questions</Badge>}
            {twinCount > 1 && <Badge variant="secondary">×{twinCount}</Badge>}
            {submittingKey !== null && (
              <Badge variant="secondary">
                <Spinner className="size-3" />
                working…
              </Badge>
            )}
          </CardTitle>
          <CardDescription className="truncate text-xs">
            {isMenu
              ? isMultiQuestion
                ? "Answer each question, then submit"
                : isMulti
                  ? "Select all answers that apply"
                  : "Pick one of the options"
              : "Approve or deny the CLI_Agent request"}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent
        className={cn(
          "flex flex-col gap-2 px-4",
          // Docked: area konten mengambil sisa kartu; scroll di dalam wrapper
          // jawaban di bawah (bukan di CardContent — header tetap terlihat).
          docked && "min-h-0 flex-1 overflow-hidden",
        )}
      >
        {/* wrap-anywhere: path file panjang tanpa spasi tidak boleh meluapkan
            kartu di layar sempit (bug mobile). */}
        {prompt.title && !isMultiQuestion && (
          <div className="wrap-anywhere rounded-md bg-muted/60 px-2.5 py-1.5 font-mono text-xs text-foreground/90">
            {prompt.title}
          </div>
        )}
        {isMenu ? (
          <>
            {/* biome-ignore lint/a11y/useSemanticElements: wrapper flex/scroll kartu; fieldset mengubah layout & styling */}
            <div
              className={cn(
                "flex flex-col gap-2",
                // Docked: HANYA area jawaban yang scroll — judul pertanyaan
                // (di atas) dan footer aksi (di bawah) tetap terlihat.
                docked && "min-h-0 flex-1 overflow-y-auto overscroll-contain",
              )}
              role="group"
              aria-label="Question options"
            >
              {isMultiQuestion ? (
                questions.map((q, qi) => {
                  const qMulti = q.multiple === true;
                  const sel = multiSel[qi] ?? new Set<string>();
                  return (
                    <div
                      // biome-ignore lint/suspicious/noArrayIndexKey: daftar pertanyaan statis, state diindeks per qi
                      key={`q-${qi}`}
                      className="flex flex-col gap-1.5 rounded-lg border border-border/50 bg-background/30 p-2.5"
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs font-medium text-muted-foreground">
                          {qi + 1} of {questions.length}
                        </span>
                        {q.header && (
                          <span className="text-xs text-muted-foreground">{q.header}</span>
                        )}
                      </div>
                      {q.question && (
                        <div className="wrap-anywhere text-sm font-medium text-foreground">
                          {q.question}
                        </div>
                      )}
                      {optionRows(
                        q.options ?? [],
                        `q${qi}`,
                        true,
                        (label) => sel.has(label),
                        (label) => toggleQOption(qi, label, qMulti),
                        () => {},
                      )}
                      {q.custom !== false &&
                        customInput({
                          value: customValues[qi] ?? "",
                          onChange: (v) => setCustomValues((prev) => ({ ...prev, [qi]: v })),
                          onSubmit: submitMultiQuestion,
                          sendDisabled: !allQuestionsAnswered,
                          busy: submittingKey === "multi-question",
                          ariaLabel: `Custom answer for question ${qi + 1}`,
                        })}
                    </div>
                  );
                })
              ) : (
                <>
                  {optionRows(
                    prompt.options ?? [],
                    "single",
                    isMulti,
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
                    })}
                </>
              )}
            </div>
            {/* Footer aksi DI LUAR area scroll — tetap terlihat saat daftar
                jawaban panjang. Mode mengambang tetap di dalam grup (kartu
                memakai tinggi alami, tidak perlu pemisahan). */}
            {docked &&
              (isMultiQuestion
                ? dismissSubmitFooter({
                    submitDisabled: !allQuestionsAnswered,
                    busy: submittingKey === "multi-question",
                    onSubmit: submitMultiQuestion,
                  })
                : isMulti &&
                  dismissSubmitFooter({
                    submitDisabled: selectedMulti.size === 0 && customValue.trim().length === 0,
                    busy: submittingKey === "multi-submit",
                    onSubmit: () => submitMulti(customValue),
                  }))}
            {!docked &&
              isMultiQuestion &&
              dismissSubmitFooter({
                submitDisabled: !allQuestionsAnswered,
                busy: submittingKey === "multi-question",
                onSubmit: submitMultiQuestion,
              })}
          </>
        ) : (
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => {
              const busy = submittingKey === action.key;
              const Icon = action.icon ? PROMPT_ACTION_ICONS[action.icon] : undefined;
              return (
                <Button
                  key={action.key}
                  type="button"
                  size="sm"
                  variant={action.variant}
                  disabled={submittingKey !== null}
                  aria-busy={busy}
                  onClick={() => resolveAll(action)}
                >
                  {busy ? (
                    <Spinner className="size-3.5" data-icon="inline-start" />
                  ) : (
                    Icon && <Icon className="size-3.5" data-icon="inline-start" />
                  )}
                  {action.label}
                </Button>
              );
            })}
          </div>
        )}
        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
