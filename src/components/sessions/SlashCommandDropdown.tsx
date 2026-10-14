/**
 * Daftar saran slash command (di dalam `ComposerSuggestions`, di atas input
 * saat `/` diketik di awal pesan). Tiap baris berisi `/nama` + petunjuk
 * argumen, dan deskripsi satu baris di bawahnya.
 *
 * Pemilihan lewat mousedown (bukan click) agar textarea tidak blur duluan;
 * baris yang disorot keyboard digulir ke tampilan. State autocomplete tetap
 * di `useSlashCommands`.
 */
import { useEffect, useRef } from "react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { SlashCommandInfo } from "@/types";

export interface SlashCommandDropdownProps {
  loading: boolean;
  error: string | null;
  matches: SlashCommandInfo[];
  highlighted: number;
  /** Pilih command ke-i (pemanggil menangani pemasukan teks + fokus). */
  onPick: (index: number) => void;
}

export function SlashCommandDropdown({
  loading,
  error,
  matches,
  highlighted,
  onPick,
}: SlashCommandDropdownProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-index="${highlighted}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Slash commands"
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1"
    >
      {loading && matches.length === 0 && (
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
          <Spinner className="size-3.5" />
          Loading commands…
        </div>
      )}
      {!loading && error && <div className="px-3 py-2 text-xs text-destructive">{error}</div>}
      {matches.map((c, i) => (
        <button
          key={c.name}
          type="button"
          role="option"
          aria-selected={i === highlighted}
          data-index={i}
          className={cn(
            "flex w-full min-w-0 flex-col gap-0.5 rounded-lg px-3 py-2 text-left",
            i === highlighted ? "bg-accent text-accent-foreground" : "hover:bg-muted/60",
          )}
          onMouseDown={(e) => {
            // mousedown (bukan click) agar textarea tidak blur duluan.
            e.preventDefault();
            onPick(i);
          }}
        >
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 font-mono text-sm font-medium">/{c.name}</span>
            {c.argumentHint && (
              <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                {c.argumentHint}
              </span>
            )}
          </span>
          {c.description && (
            <span className="truncate text-xs text-muted-foreground">{c.description}</span>
          )}
        </button>
      ))}
    </div>
  );
}
