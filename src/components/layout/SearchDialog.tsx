/**
 * Command palette pencarian (tombol "Search" di sidebar atau Ctrl/⌘+K).
 *
 * - Kolom cari di atas; hasil di bawah dalam seksi berjudul kecil:
 *   kueri kosong -> "Recent sessions"; ada kueri -> "Projects" (nama cocok)
 *   lalu "Sessions" (judul / model cocok). Logika: `lib/search-palette.ts`.
 * - Baris dua tingkat seperti `SessionRow`: logo agent, judul (bagian yang
 *   cocok ditebalkan), subjudul status (bila bukan stopped) · Project ·
 *   waktu. Baris Project: ikon folder, nama, jumlah Session · path.
 * - Navigasi keyboard: ↑/↓ memindah sorotan, Enter membuka, Esc menutup.
 */
import { FolderIcon, SearchIcon } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { AgentLogo } from "@/components/sessions/AgentLogo";
import { StatusLabel } from "@/components/sessions/SessionRow";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { formatRelativeTime } from "@/lib/project-overview";
import { projectPath, sessionPath } from "@/lib/routes";
import { buildPaletteResults, highlightMatches } from "@/lib/search-palette";
import type { SidebarProjectGroup } from "@/lib/sidebar-groups";
import { cn } from "@/lib/utils";

export interface SearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Seluruh grup (belum difilter). */
  groups: SidebarProjectGroup[];
  onSelect: (path: string) => void;
}

/** Satu baris yang bisa dipilih (Project atau Session). */
interface PaletteRow {
  key: string;
  path: string;
  icon: ReactNode;
  title: string;
  subtitle: ReactNode;
}

function Dot() {
  return (
    <span className="opacity-50" aria-hidden>
      ·
    </span>
  );
}

function Highlighted({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightMatches(text, query).map((p, i) =>
        p.match ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: potongan teks statis
          <mark key={i} className="bg-transparent font-semibold text-foreground">
            {p.text}
          </mark>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: potongan teks statis
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
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

  const trimmed = query.trim();
  const sections = useMemo(() => {
    const { projects, sessions } = buildPaletteResults(groups, query);
    const projectRows: PaletteRow[] = projects.map(({ project, sessionCount }) => ({
      key: `project:${project.id}`,
      path: projectPath(project.id),
      icon: <FolderIcon className="size-[18px] text-muted-foreground" aria-hidden />,
      title: project.name,
      subtitle: (
        <>
          <span className="shrink-0">
            {sessionCount} {sessionCount === 1 ? "session" : "sessions"}
          </span>
          <Dot />
          <span className="truncate font-mono text-xs">{project.path}</span>
        </>
      ),
    }));
    const sessionRows: PaletteRow[] = sessions.map(({ session, title, projectName }) => ({
      key: `session:${session.id}`,
      path: sessionPath(session.projectId, session.id),
      icon: (
        <AgentLogo agentType={session.agentType} className="size-[18px] text-muted-foreground" />
      ),
      title,
      subtitle: (
        <>
          {session.status !== "stopped" && (
            <>
              <StatusLabel session={session} />
              <Dot />
            </>
          )}
          <span className="truncate">{projectName}</span>
          <Dot />
          <span className="shrink-0 tabular-nums">{formatRelativeTime(session.updatedAt)}</span>
        </>
      ),
    }));
    return [
      { label: "Projects", rows: projectRows },
      { label: query.trim() === "" ? "Recent sessions" : "Sessions", rows: sessionRows },
    ].filter((s) => s.rows.length > 0);
  }, [groups, query]);
  const rows = sections.flatMap((s) => s.rows);

  // Sorotan kembali ke atas saat kueri berubah.
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

  const choose = (row: PaletteRow | undefined) => {
    if (!row) return;
    onOpenChange(false);
    onSelect(row.path);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(rows[highlight]);
    }
  };

  const activeId = rows[highlight] ? `search-result-${highlight}` : undefined;
  let index = 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[15%] translate-y-0 gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-xl"
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">
          Find a project or session by name.
        </DialogDescription>

        <div className="flex items-center gap-3 border-b px-4">
          <SearchIcon className="size-[18px] shrink-0 text-muted-foreground" aria-hidden />
          <input
            autoFocus
            type="text"
            role="combobox"
            aria-expanded
            aria-controls="search-results"
            aria-activedescendant={activeId}
            aria-label="Search projects and sessions"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search projects and sessions"
            className="h-14 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-[15px]"
          />
        </div>

        <div
          ref={listRef}
          id="search-results"
          role="listbox"
          aria-label="Results"
          className="max-h-[min(60vh,440px)] overflow-y-auto p-2"
        >
          {rows.length === 0 ? (
            // AdwStatusPage kecil.
            <div className="flex flex-col items-center gap-1 px-6 py-10 text-center">
              <p className="text-[15px] font-medium">
                {trimmed === "" ? "No Sessions Yet" : "No Results Found"}
              </p>
              <p className="text-[13px] text-muted-foreground">
                {trimmed === ""
                  ? "Sessions you start will show up here."
                  : `Nothing matches “${trimmed}”.`}
              </p>
            </div>
          ) : (
            sections.map((section) => (
              // biome-ignore lint/a11y/useSemanticElements: grup opsi di dalam listbox
              <div key={section.label} role="group" aria-label={section.label} className="pb-1">
                <p
                  aria-hidden
                  className="px-3 pt-2 pb-1.5 text-[13px] font-semibold text-muted-foreground"
                >
                  {section.label}
                </p>
                {section.rows.map((row) => {
                  const i = index++;
                  return (
                    <div
                      key={row.key}
                      id={`search-result-${i}`}
                      data-index={i}
                      role="option"
                      aria-selected={i === highlight}
                      tabIndex={-1}
                      onMouseMove={() => setHighlight(i)}
                      onClick={() => choose(row)}
                      onKeyDown={() => {}}
                      className={cn(
                        "flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-3 py-2",
                        i === highlight && "bg-muted",
                      )}
                    >
                      <span className="flex shrink-0 items-center">{row.icon}</span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-[15px] leading-5 text-foreground/90">
                          <Highlighted text={row.title} query={query} />
                        </span>
                        <span className="flex min-w-0 items-center gap-1.5 text-[13px] leading-snug text-muted-foreground">
                          {row.subtitle}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
