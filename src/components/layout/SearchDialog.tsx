/**
 * Command palette pencarian Session (dibuka dari tombol "Search" di sidebar
 * atau pintasan Ctrl/⌘+K).
 *
 * - Input di atas, daftar hasil di bawah: tiap baris = judul Session + nama
 *   Project. Query kosong -> Session terbaru dari seluruh Project.
 * - Navigasi keyboard: ↑/↓ memindah sorotan, Enter membuka, Esc menutup.
 * - Pencocokan memakai `filterSidebarGroups` (nama Project / judul Session).
 */
import { FolderIcon, MessageSquareIcon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { sessionPath } from "@/lib/routes";
import { SESSION_STATUS_DOT, SESSION_STATUS_LABEL } from "@/lib/session-status";
import { displaySessionTitle } from "@/lib/session-title";
import { filterSidebarGroups, type SidebarProjectGroup } from "@/lib/sidebar-groups";
import { cn } from "@/lib/utils";
import type { Session } from "@/types";

/** Batas hasil yang dirender agar daftar tetap ringan. */
const MAX_RESULTS = 50;

interface SearchResult {
  session: Session;
  projectName: string;
  title: string;
}

export interface SearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Seluruh grup (belum difilter). */
  groups: SidebarProjectGroup[];
  onSelect: (path: string) => void;
}

export function SearchDialog({ open, onOpenChange, groups, onSelect }: SearchDialogProps) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset setiap kali dibuka.
  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlight(0);
    }
  }, [open]);

  const results = useMemo<SearchResult[]>(() => {
    const titleOf = (s: Session) => displaySessionTitle(s.title);
    const filtered = filterSidebarGroups(groups, query, titleOf);
    const flat = filtered.flatMap((g) =>
      g.sessions.map((session) => ({
        session,
        projectName: g.project.name,
        title: titleOf(session),
      })),
    );
    // Terbaru di atas lintas Project.
    flat.sort((a, b) => b.session.updatedAt - a.session.updatedAt);
    return flat.slice(0, MAX_RESULTS);
  }, [groups, query]);

  // Sorotan tetap valid saat hasil berubah.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset saat query berubah
  useEffect(() => {
    setHighlight(0);
  }, [query]);

  // Gulirkan baris tersorot ke dalam viewport.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${highlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  const choose = (r: SearchResult | undefined) => {
    if (!r) return;
    onOpenChange(false);
    onSelect(sessionPath(r.session.projectId, r.session.id));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(results[highlight]);
    }
  };

  const trimmed = query.trim();
  const activeId = results[highlight] ? `search-result-${highlight}` : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[15%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        <DialogTitle className="sr-only">Search sessions</DialogTitle>
        <DialogDescription className="sr-only">
          Type to filter sessions by title or project name.
        </DialogDescription>

        <div className="flex items-center gap-2 border-b px-4">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            autoFocus
            type="text"
            role="combobox"
            aria-expanded
            aria-controls="search-results"
            aria-activedescendant={activeId}
            aria-label="Search sessions"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search sessions…"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden shrink-0 rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">
            Esc
          </kbd>
        </div>

        <div
          ref={listRef}
          id="search-results"
          role="listbox"
          aria-label="Results"
          className="max-h-[min(60vh,420px)] overflow-y-auto p-2"
        >
          {results.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              {trimmed === "" ? "No sessions yet." : `No matches for “${trimmed}”.`}
            </p>
          ) : (
            <>
              <p className="px-2 pt-1 pb-2 text-xs font-medium text-muted-foreground">
                {trimmed === "" ? "Recent" : "Results"}
              </p>
              {results.map((r, i) => (
                <div
                  key={r.session.id}
                  id={`search-result-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === highlight}
                  tabIndex={-1}
                  onMouseMove={() => setHighlight(i)}
                  onClick={() => choose(r)}
                  onKeyDown={() => {}}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm",
                    i === highlight && "bg-accent text-accent-foreground",
                  )}
                >
                  <MessageSquareIcon
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">{r.title}</span>
                  <span className="flex max-w-[40%] shrink-0 items-center gap-1 truncate text-xs text-muted-foreground">
                    <FolderIcon className="size-3 shrink-0" aria-hidden />
                    <span className="truncate">{r.projectName}</span>
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      SESSION_STATUS_DOT[r.session.status],
                    )}
                  />
                  <span className="sr-only">{SESSION_STATUS_LABEL[r.session.status]}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
