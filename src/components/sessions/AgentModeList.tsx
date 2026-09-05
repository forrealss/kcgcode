/**
 * Daftar opsi agent (mode) opencode — dipakai di dalam `PopoverContent`
 * (`AgentPicker`, desktop) maupun langsung di `SheetContent` (mobile, tanpa
 * popover bersarang). Setiap baris menampilkan ikon + nama + deskripsi
 * singkat, supaya jelas ini adalah *pemilihan mode*, bukan tombol biasa.
 */
import { CheckIcon, CompassIcon, HammerIcon, ListTreeIcon } from "lucide-react";
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
}: AgentModeListProps) {
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

  return (
    <div className={cn("flex flex-col", className)}>
      <button
        type="button"
        disabled={disabled || saving}
        onClick={() => onPick(null)}
        className={cn(
          "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm",
          "hover:bg-accent hover:text-accent-foreground disabled:opacity-50",
          activeAgent === null && "bg-accent/60",
        )}
      >
        <CompassIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">Default</span>
          <span className="block text-muted-foreground">
            opencode picks the agent (usually build)
          </span>
        </span>
        {activeAgent === null && <CheckIcon className="mt-0.5 size-4 shrink-0" />}
      </button>
      {(agents ?? []).map((a) => {
        const Icon = agentIcon(a.name, a.mode);
        const selected = a.name === activeAgent;
        const plan = a.name.toLowerCase() === "plan";
        return (
          <button
            key={a.name}
            type="button"
            disabled={disabled || saving}
            onClick={() => onPick(a.name)}
            className={cn(
              "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm",
              "hover:bg-accent hover:text-accent-foreground disabled:opacity-50",
              selected && "bg-accent/60",
            )}
          >
            <Icon
              className={cn(
                "mt-0.5 size-4 shrink-0 text-muted-foreground",
                plan && "text-amber-500",
              )}
            />
            <span className="min-w-0 flex-1">
              <span className={cn("block font-medium", plan && "text-amber-500")}>{a.name}</span>
              {a.description && (
                <span className="line-clamp-2 block text-muted-foreground">{a.description}</span>
              )}
            </span>
            {selected && <CheckIcon className="mt-0.5 size-4 shrink-0" />}
          </button>
        );
      })}
      {!loading && (agents ?? []).length === 0 && !error && (
        <div className="px-3 py-2.5 text-sm text-muted-foreground">No agents found.</div>
      )}
    </div>
  );
}
