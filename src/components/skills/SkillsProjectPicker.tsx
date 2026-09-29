/**
 * Pemilih Project di halaman Skills — tombol besar (ikon folder, nama, path)
 * yang membuka popover berisi daftar Project dengan kotak cari.
 *
 * Kotak cari hanya muncul bila Project cukup banyak. Navigasi keyboard:
 * ↑/↓ memindah sorotan, Enter memilih, Esc menutup (bawaan Popover).
 */
import { CheckIcon, ChevronsUpDownIcon, FolderIcon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Project } from "@/types";

/** Kotak cari tampil mulai jumlah Project ini. */
const SEARCH_THRESHOLD = 6;

export interface SkillsProjectPickerProps {
  projects: Project[];
  selected: Project | null;
  onSelect: (projectId: string) => void;
}

export function SkillsProjectPicker({ projects, selected, onSelect }: SkillsProjectPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const showSearch = projects.length >= SEARCH_THRESHOLD;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return projects;
    return projects.filter(
      (p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q),
    );
  }, [projects, query]);

  // Buka: reset pencarian, sorot Project terpilih.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    const idx = projects.findIndex((p) => p.id === selected?.id);
    setHighlight(idx >= 0 ? idx : 0);
  }, [open, projects, selected?.id]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset saat query berubah
  useEffect(() => {
    setHighlight(0);
  }, [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${highlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  const pick = (p: Project | undefined) => {
    if (!p) return;
    onSelect(p.id);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(filtered[highlight]);
    }
  };

  const activeId = filtered[highlight] ? `skills-project-${highlight}` : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-label={selected ? `Project: ${selected.name}. Change project` : "Select a project"}
          className={cn(
            "group flex w-full min-w-0 items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left shadow-xs transition-colors outline-none hover:bg-accent/50 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:border-ring sm:w-80",
          )}
        >
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-lg",
              selected ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
            )}
          >
            <FolderIcon className="size-4" aria-hidden />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              Install to
            </span>
            <span
              className={cn("truncate text-sm font-medium", !selected && "text-muted-foreground")}
            >
              {selected?.name ?? "Select a project"}
            </span>
          </span>
          <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) min-w-72 p-0"
        onOpenAutoFocus={(e) => {
          // Fokus ke kotak cari (bila ada), selain itu ke daftar agar ↑/↓ jalan.
          e.preventDefault();
          (searchRef.current ?? listRef.current)?.focus();
        }}
      >
        {showSearch && (
          <div className="flex items-center gap-2 border-b px-3">
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <input
              ref={searchRef}
              type="text"
              role="combobox"
              aria-expanded
              aria-controls="skills-project-list"
              aria-activedescendant={activeId}
              aria-label="Search projects"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search projects…"
              className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        )}
        <div
          ref={listRef}
          id="skills-project-list"
          role="listbox"
          aria-label="Projects"
          aria-activedescendant={showSearch ? undefined : activeId}
          tabIndex={showSearch ? -1 : 0}
          onKeyDown={showSearch ? undefined : onKeyDown}
          className="max-h-72 overflow-y-auto p-1 outline-none"
        >
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No projects match “{query.trim()}”.
            </p>
          ) : (
            filtered.map((p, i) => {
              const isSelected = p.id === selected?.id;
              return (
                <div
                  key={p.id}
                  id={`skills-project-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={-1}
                  onMouseMove={() => setHighlight(i)}
                  onClick={() => pick(p)}
                  onKeyDown={() => {}}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-sm",
                    i === highlight && "bg-accent text-accent-foreground",
                  )}
                >
                  <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{p.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{p.path}</span>
                  </span>
                  {isSelected && <CheckIcon className="size-4 shrink-0" aria-hidden />}
                </div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
