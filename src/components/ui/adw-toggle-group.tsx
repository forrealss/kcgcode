/**
 * Toggle group ala AdwToggleGroup (libadwaita 1.7): palung terisi berisi
 * beberapa pilihan sejajar; pilihan aktif "terangkat" (latar terang +
 * bayangan di mode terang, lebih terang dari palung di mode gelap).
 *
 * Satu pilihan selalu aktif (bukan multi-select). Tombol memakai
 * `aria-pressed` di dalam `role="group"` berlabel.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface AdwToggleOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Ikon / logo di kiri label. */
  icon?: ReactNode;
  /** Label aksesibel bila `label` bukan teks biasa. */
  ariaLabel?: string;
  title?: string;
}

export interface AdwToggleGroupProps<T extends string> {
  /** Label grup untuk pembaca layar. */
  label: string;
  value: T;
  options: readonly AdwToggleOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
}

export function AdwToggleGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  className,
}: AdwToggleGroupProps<T>) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: grup tombol segmented, bukan fieldset form.
    <div
      role="group"
      aria-label={label}
      className={cn(
        "grid shrink-0 auto-cols-fr grid-flow-col gap-0.5 rounded-[10px] bg-black/[0.06] p-[3px] dark:bg-white/[0.07]",
        className,
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            aria-label={o.ariaLabel}
            title={o.title}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex h-8 min-w-0 items-center justify-center gap-2 rounded-[7px] px-2 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-60",
              active
                ? "bg-white text-foreground shadow-sm dark:bg-white/[0.15] dark:shadow-none"
                : "text-foreground/70 hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.05]",
            )}
          >
            {o.icon}
            <span className="truncate">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
