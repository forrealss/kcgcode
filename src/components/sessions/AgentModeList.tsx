/**
 * Daftar opsi agent (mode) opencode — dipakai di dalam `PopoverContent`
 * (`AgentPicker`, desktop) maupun langsung di `SheetContent` (mobile, tanpa
 * popover bersarang). Setiap baris menampilkan ikon + nama + deskripsi
 * singkat, supaya jelas ini adalah *pemilihan mode*, bukan tombol biasa.
 *
 * Kedua varian: nama dikapitalisasi, ikon dalam kotak, deskripsi 1 baris,
 * dan agent pembantu (tanpa deskripsi / mode `subagent`, mis. compaction /
 * title / summary) dilipat ke "More modes" agar pilihan utama tidak tenggelam.
 * - `popover` (desktop): baris ringkas, centang di kanan.
 * - `sheet` (mobile): baris lebih tinggi untuk jempol, indikator radio.
 */
import {
  CheckIcon,
  ChevronDownIcon,
  CompassIcon,
  HammerIcon,
  ListTreeIcon,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { AgentOption } from "@/server/services/opencode-client";

/** Ikon per agent: khusus dulu (build/plan), sisanya fallback per mode. */
function agentIcon(name: string, mode: AgentOption["mode"]) {
  const n = name.toLowerCase();
  if (n === "build") return HammerIcon;
  if (n === "plan") return ListTreeIcon;
  return mode === "primary" ? CompassIcon : ListTreeIcon;
}

/** Agent utama = primary/all yang punya deskripsi; sisanya pembantu. */
function isMainAgent(a: AgentOption): boolean {
  return a.mode !== "subagent" && Boolean(a.description);
}

function titleCase(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export interface AgentModeListProps {
  agents: AgentOption[] | null;
  loading: boolean;
  error: string | null;
  /** Agent aktif saat ini; null = default opencode (build). */
  activeAgent: string | null;
  saving?: boolean;
  disabled?: boolean;
  onPick: (name: string | null) => void;
  className?: string;
  variant?: "popover" | "sheet";
}

export function AgentModeList({
  agents,
  loading,
  error,
  activeAgent,
  saving = false,
  disabled = false,
  onPick,
  className,
  variant = "popover",
}: AgentModeListProps) {
  const sheet = variant === "sheet";
  const all = agents ?? [];
  const main = all.filter(isMainAgent);
  const extra = all.filter((a) => !isMainAgent(a));
  const [expanded, setExpanded] = useState(false);
  // Agent aktif ada di "More modes" -> selalu terbuka agar pilihan terlihat.
  const activeInExtra = extra.some((a) => a.name === activeAgent);
  const showExtra = expanded || activeInExtra;

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground">
        <Spinner className="size-3.5" />
        Loading agents…
      </div>
    );
  }

  if (error) {
    return <div className="px-3 py-2.5 text-sm text-destructive">{error}</div>;
  }

  const row = (key: string, opts: RowProps) => (
    <ModeRow key={key} {...opts} sheet={sheet} disabled={disabled || saving} />
  );

  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      {row("__default", {
        icon: CompassIcon,
        label: "Default",
        description: "Let KCG Code choose (usually Build)",
        selected: activeAgent === null,
        onClick: () => onPick(null),
      })}
      {main.map((a) =>
        row(a.name, {
          icon: agentIcon(a.name, a.mode),
          label: titleCase(a.name),
          description: a.description,
          selected: a.name === activeAgent,
          accent: a.name.toLowerCase() === "plan",
          onClick: () => onPick(a.name),
        }),
      )}

      {extra.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => !activeInExtra && setExpanded((v) => !v)}
            aria-expanded={showExtra}
            className="mt-1 flex w-full items-center gap-1.5 rounded-lg px-3 py-2.5 text-left text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <ChevronDownIcon
              className={cn("size-3.5 transition-transform", !showExtra && "-rotate-90")}
              aria-hidden
            />
            More modes
            <span className="tabular-nums opacity-70">{extra.length}</span>
          </button>
          {showExtra &&
            extra.map((a) =>
              row(a.name, {
                icon: agentIcon(a.name, a.mode),
                label: titleCase(a.name),
                description: a.description,
                selected: a.name === activeAgent,
                compact: true,
                onClick: () => onPick(a.name),
              }),
            )}
        </>
      )}

      {all.length === 0 && (
        <div className="px-3 py-2.5 text-sm text-muted-foreground">No agents found.</div>
      )}
    </div>
  );
}

interface RowProps {
  icon: LucideIcon;
  label: string;
  description: string | null;
  selected: boolean;
  accent?: boolean;
  /** Baris pembantu di "More modes": lebih pendek. */
  compact?: boolean;
  onClick: () => void;
}

function ModeRow({
  icon: Icon,
  label,
  description,
  selected,
  accent,
  compact,
  onClick,
  sheet,
  disabled,
}: RowProps & { sheet: boolean; disabled: boolean }) {
  if (!sheet) {
    return (
      <button
        type="button"
        aria-pressed={selected}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          "group/row flex w-full items-center gap-2.5 rounded-lg px-2 text-left transition-colors outline-none",
          "hover:bg-accent focus-visible:bg-accent disabled:opacity-50",
          compact ? "min-h-9 py-1.5" : "min-h-12 py-2",
          selected && "bg-accent/60",
        )}
      >
        <span
          className={cn(
            "flex shrink-0 items-center justify-center rounded-md",
            compact ? "size-6" : "size-8",
            selected
              ? "bg-primary/15 text-primary dark:bg-primary/25"
              : accent
                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                : "bg-muted text-muted-foreground group-hover/row:bg-background/60",
          )}
          aria-hidden
        >
          <Icon className={compact ? "size-3.5" : "size-4"} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn("truncate text-sm leading-5", selected && "font-medium")}>
            {label}
          </span>
          {description && !compact && (
            <span className="truncate text-xs text-muted-foreground" title={description}>
              {description}
            </span>
          )}
        </span>
        <CheckIcon
          className={cn("size-4 shrink-0 text-primary", !selected && "invisible")}
          aria-hidden
        />
      </button>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 text-left transition-colors outline-none",
        "active:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50",
        compact ? "min-h-11 py-2" : "min-h-14 py-2.5",
        selected ? "bg-primary/10 dark:bg-primary/15" : "hover:bg-muted/60",
      )}
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-lg",
          compact ? "size-7" : "size-9",
          selected
            ? "bg-primary/15 text-primary dark:bg-primary/25"
            : accent
              ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
              : "bg-muted text-muted-foreground",
        )}
        aria-hidden
      >
        <Icon className={compact ? "size-3.5" : "size-[18px]"} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn("text-[15px] leading-5", selected && "font-medium")}>{label}</span>
        {description && !compact && (
          <span className="line-clamp-1 text-[13px] leading-snug text-muted-foreground">
            {description}
          </span>
        )}
      </span>
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
          selected
            ? "border-primary bg-primary text-primary-foreground"
            : "border-muted-foreground/40",
        )}
        aria-hidden
      >
        {selected && <CheckIcon className="size-3" strokeWidth={3} />}
      </span>
    </button>
  );
}
