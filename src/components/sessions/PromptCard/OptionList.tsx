/**
 * Baris jawaban kartu pertanyaan bergaya boxed list ala libadwaita (sama
 * dengan `PrefsGroup` / `ActionRow` / `EntryRow` di settings/prefs.tsx):
 * wadah daftar, baris opsi, dan baris jawaban bebas ("Other").
 */
import { ArrowUpIcon, CheckIcon, ChevronRightIcon, PencilLineIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { PromptOption } from "@/types";

/** Daftar opsi bergaya boxed list (kotak membulat, baris berpemisah). */
export function OptionList({ children }: { children: ReactNode }) {
  // Sama dengan isi `PrefsGroup` (settings/prefs.tsx): kartu membulat,
  // baris berpemisah, latar card.
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <ul className="flex flex-col divide-y">{children}</ul>
    </div>
  );
}

/**
 * Mode baris opsi:
 * - `action`   : single choice — ketuk baris langsung menjawab.
 * - `radio`    : single choice dalam multi-question — memilih, dikirim lewat
 *                Submit.
 * - `checkbox` : multi-select — centang beberapa, dikirim lewat Submit.
 */
export type OptionRowMode = "action" | "radio" | "checkbox";

/**
 * Baris-baris opsi question. Baris minimal 52px di HP (target sentuh
 * nyaman), 44px di desktop.
 */
export function OptionRows({
  options,
  mode,
  shortcuts,
  submittingKey,
  checked,
  onToggle,
  onPick,
}: {
  options: PromptOption[];
  mode: OptionRowMode;
  /** Tampilkan pintasan angka 1–9 (daftar opsi utama / langkah wizard aktif). */
  shortcuts: boolean;
  /** Aksi yang sedang dikirim — non-null mengunci semua baris. */
  submittingKey: string | null;
  /** Mode `radio` / `checkbox`: opsi sedang terpilih. */
  checked?: (label: string) => boolean;
  /** Mode `radio` / `checkbox`: baris diketuk. */
  onToggle?: (label: string) => void;
  /** Mode `action`: baris diketuk = jawaban. */
  onPick?: (label: string) => void;
}) {
  return options.map((opt, i) => {
    const isChecked = mode !== "action" && (checked?.(opt.label) ?? false);
    const busy = mode === "action" && submittingKey === `option-${opt.label}`;
    const disabled = submittingKey !== null;
    const shortcut = shortcuts && i < 9 ? String(i + 1) : undefined;
    return (
      <li key={opt.label}>
        <button
          type="button"
          role={mode === "checkbox" ? "checkbox" : mode === "radio" ? "radio" : undefined}
          {...(mode !== "action" ? { "aria-checked": isChecked } : {})}
          aria-busy={busy}
          aria-keyshortcuts={shortcut}
          disabled={disabled}
          onClick={() => (mode === "action" ? onPick?.(opt.label) : onToggle?.(opt.label))}
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
}

/**
 * Baris jawaban bebas. Enter mengirim sesuai mode kartu. `showSend: false`
 * = jawaban ikut terkirim lewat Submit di footer (multi-question /
 * multi-select), jadi tombol kirim per baris disembunyikan.
 * Font 16px di HP: iOS Safari tidak men-zoom halaman saat input difokus.
 */
export function CustomAnswerRow({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled,
  sendDisabled,
  busy,
  ariaLabel = "Your own answer",
  showSend = true,
  enterHint,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  /** Kartu sedang mengirim — input & tombol kirim terkunci. */
  disabled: boolean;
  sendDisabled: boolean;
  busy: boolean;
  ariaLabel?: string;
  showSend?: boolean;
  enterHint?: "send" | "next";
}) {
  return (
    // Baris ala `EntryRow` (settings/prefs.tsx): tinggal di DALAM boxed list
    // opsi sebagai baris terakhir, label kecil di atas input; tombol kirim
    // bulat muncul begitu ada isi.
    <li>
      <label className="flex min-h-14 cursor-text items-center gap-3 px-4 py-2 focus-within:bg-muted/30">
        <PencilLineIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[12px] leading-4 text-muted-foreground">Other</span>
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                onSubmit();
              }
            }}
            placeholder={placeholder}
            disabled={disabled}
            aria-label={ariaLabel}
            enterKeyHint={enterHint ?? (showSend ? "send" : "next")}
            // 16px di HP: iOS Safari tidak men-zoom saat input difokus.
            className="h-7 w-full min-w-0 bg-transparent text-base outline-none placeholder:text-muted-foreground/70 disabled:opacity-60 sm:text-[15px]"
          />
        </span>
        {showSend && (
          <button
            type="button"
            disabled={disabled || sendDisabled}
            aria-busy={busy}
            aria-label="Send your answer"
            onClick={onSubmit}
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xs transition-opacity outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-0 sm:size-8",
              busy && "disabled:opacity-60",
            )}
          >
            {busy ? <Spinner className="size-4" /> : <ArrowUpIcon className="size-4" />}
          </button>
        )}
      </label>
    </li>
  );
}
