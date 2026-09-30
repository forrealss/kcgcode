/**
 * Primitif halaman preferensi bergaya GNOME Settings / libadwaita:
 * - `PrefsGroup`   judul + deskripsi grup, isi = "boxed list" (kartu
 *                  membulat, baris berpemisah).
 * - `ActionRow`    judul & subjudul di kiri, konten (suffix) di kanan. Bisa
 *                  diklik (tombol / tautan) dengan chevron seperti GNOME.
 * - `EntryRow`     label kecil di atas input sebaris; tombol ✓ muncul saat
 *                  nilai berubah (seperti AdwEntryRow "apply button").
 * - `SwitchRow` tidak dibutuhkan saat ini; `ComboRow` diwakili ActionRow +
 *   Select di suffix.
 */
import { CheckIcon, ChevronRightIcon } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export function PrefsGroup({
  id,
  title,
  description,
  suffix,
  children,
}: {
  id?: string;
  title?: string;
  description?: ReactNode;
  /** Aksi kecil di kanan judul grup (mis. tombol). */
  suffix?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      id={id}
      aria-labelledby={title ? headingId : undefined}
      className="flex scroll-mt-6 flex-col gap-2.5"
    >
      {(title || suffix) && (
        // Suffix sebaris dengan judul (bukan deskripsi) agar deskripsi tetap
        // selebar kolom di layar sempit, tidak terjepit tombol di kanannya.
        <div className="flex flex-col gap-0.5 px-1">
          <div className="flex min-h-8 items-center justify-between gap-3">
            {title && (
              <h2 id={headingId} className="min-w-0 text-[15px] font-semibold tracking-tight">
                {title}
              </h2>
            )}
            {suffix && <div className="-mr-2 ml-auto shrink-0">{suffix}</div>}
          </div>
          {description && <p className="text-[13px] text-muted-foreground">{description}</p>}
        </div>
      )}
      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <ul className="flex flex-col divide-y">{children}</ul>
      </div>
    </section>
  );
}

interface ActionRowProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Ikon / avatar di kiri. */
  prefix?: ReactNode;
  /** Kontrol / nilai di kanan. */
  suffix?: ReactNode;
  /** Baris bisa diklik -> tampilkan chevron. */
  onActivate?: () => void;
  /** Gaya merah (aksi berbahaya). */
  destructive?: boolean;
  disabled?: boolean;
  /** Tautkan `<label>` ke kontrol di suffix. */
  htmlFor?: string;
  /**
   * Di layar sempit (< sm) suffix selalu turun ke bawah teks. Cocok untuk
   * baris dengan subjudul panjang + tombol, agar subjudul tidak terjepit.
   * Tanpa ini suffix tetap turun otomatis bila ruang teks < 10rem.
   */
  stack?: boolean;
  className?: string;
}

export function ActionRow({
  title,
  subtitle,
  prefix,
  suffix,
  onActivate,
  destructive,
  disabled,
  htmlFor,
  stack,
  className,
}: ActionRowProps) {
  const titleClass = cn("text-[15px] leading-5", destructive && "text-destructive");
  const body = (
    <>
      {prefix && <span className="flex shrink-0 items-center">{prefix}</span>}
      {/* Teks + suffix dalam flex-wrap: suffix pindah ke baris berikutnya
          (rata kiri dengan teks) saat lebar tidak cukup, alih-alih memeras
          subjudul jadi kolom sempit. */}
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
        <span
          className={cn(
            "flex min-w-[min(100%,10rem)] flex-1 flex-col gap-0.5 py-0.5",
            stack && "basis-full sm:basis-0",
          )}
        >
          {htmlFor ? (
            <label htmlFor={htmlFor} className={titleClass}>
              {title}
            </label>
          ) : (
            <span className={titleClass}>{title}</span>
          )}
          {subtitle && (
            <span className="text-[13px] leading-snug text-muted-foreground">{subtitle}</span>
          )}
        </span>
        {suffix && <span className="flex shrink-0 items-center gap-2">{suffix}</span>}
      </span>
      {onActivate && (
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      )}
    </>
  );

  const base = "flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left";

  return (
    <li className={className}>
      {onActivate ? (
        <button
          type="button"
          onClick={onActivate}
          disabled={disabled}
          className={cn(
            base,
            "transition-colors outline-none hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:ring-inset active:bg-muted disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          {body}
        </button>
      ) : (
        <div className={base}>{body}</div>
      )}
    </li>
  );
}

/**
 * Baris input ala AdwEntryRow: label kecil di atas nilai; tombol ✓ muncul
 * saat nilai berubah. Enter menyimpan, Esc mengembalikan nilai awal.
 */
export function EntryRow({
  title,
  value,
  placeholder,
  maxLength,
  autoComplete,
  onSave,
}: {
  title: string;
  value: string;
  placeholder?: string;
  maxLength?: number;
  autoComplete?: string;
  /** Kembalikan pesan error untuk ditampilkan, atau null bila sukses. */
  onSave: (next: string) => Promise<string | null>;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastValue, setLastValue] = useState(value);
  // Nilai dari server berubah (disimpan di tempat lain) -> sinkronkan draft.
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(value);
  }
  const dirty = draft.trim() !== value;

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setError(await onSave(draft.trim()));
    setSaving(false);
  };

  return (
    <li>
      <form
        className="flex min-h-14 items-center gap-3 px-4 py-2 focus-within:bg-muted/30"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="flex min-w-0 flex-1 flex-col">
          <label htmlFor={id} className="text-[12px] leading-4 text-muted-foreground">
            {title}
          </label>
          <input
            id={id}
            value={draft}
            maxLength={maxLength}
            placeholder={placeholder}
            autoComplete={autoComplete}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-err` : undefined}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setDraft(value);
                setError(null);
              }
            }}
            // 16px di mobile: iOS Safari men-zoom halaman saat fokus ke input < 16px.
            className="h-7 w-full min-w-0 bg-transparent text-base outline-none placeholder:text-muted-foreground/70 sm:text-[15px]"
          />
          {error && (
            <span id={`${id}-err`} role="alert" className="text-[12px] text-destructive">
              {error}
            </span>
          )}
        </div>
        {dirty && (
          <button
            type="submit"
            aria-label={`Save ${title.toLowerCase()}`}
            disabled={saving}
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xs transition-opacity outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60"
          >
            {saving ? <Spinner className="size-4" /> : <CheckIcon className="size-4" />}
          </button>
        )}
      </form>
    </li>
  );
}

/** Pil status kecil untuk suffix baris (mis. "On" / "Off"). */
export function RowBadge({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "success" | "warning";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[12px] font-medium",
        tone === "success" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        tone === "warning" && "bg-amber-500/15 text-amber-800 dark:text-amber-300",
        tone === "muted" && "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}
