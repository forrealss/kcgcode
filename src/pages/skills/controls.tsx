/** Kontrol halaman Skills: tombol tab (Browse / Installed) dan kolom cari. */
import { SearchIcon, XIcon } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export type Tab = "browse" | "installed";

export function TabButton({
  id,
  current,
  onSelect,
  children,
}: {
  id: Tab;
  current: Tab;
  onSelect: (tab: Tab) => void;
  children: ReactNode;
}) {
  const active = id === current;
  return (
    <button
      type="button"
      role="tab"
      id={`skills-tab-${id}`}
      aria-selected={active}
      aria-controls={`skills-panel-${id}`}
      tabIndex={active ? 0 : -1}
      onClick={() => onSelect(id)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          const next: Tab = id === "browse" ? "installed" : "browse";
          onSelect(next);
          document.getElementById(`skills-tab-${next}`)?.focus();
        }
      }}
      className={cn(
        "-mb-px flex h-10 items-center gap-1.5 border-b-2 px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Kolom cari tab aktif (Browse = skills.sh, Installed = filter lokal). Esc
 * mengosongkan; tombol silang mengosongkan lalu fokus kembali ke kolom.
 */
export function SearchField({
  inputRef,
  tab,
  value,
  onChange,
  busy,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  tab: Tab;
  value: string;
  onChange: (q: string) => void;
  /** Pencarian skills.sh sedang berjalan (spinner hanya di tab Browse). */
  busy: boolean;
}) {
  const placeholder =
    tab === "browse" ? "Search skills.sh — e.g. react, testing, docs" : "Filter installed skills";

  return (
    <div className="relative flex min-w-0 items-center">
      <SearchIcon
        className="pointer-events-none absolute left-3.5 size-4 text-muted-foreground"
        aria-hidden
      />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value !== "") {
            e.preventDefault();
            onChange("");
          }
        }}
        placeholder={placeholder}
        aria-label={tab === "browse" ? "Search skills on skills.sh" : "Filter installed skills"}
        aria-describedby="skills-search-hint"
        className="h-11 w-full rounded-xl border bg-card pr-20 pl-10 text-sm shadow-xs outline-none transition-shadow placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 [&::-webkit-search-cancel-button]:hidden"
      />
      <div className="absolute right-2 flex items-center gap-1">
        {busy && tab === "browse" && <Spinner className="size-4 text-muted-foreground" />}
        {value !== "" ? (
          <button
            type="button"
            onClick={() => {
              onChange("");
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-4" />
          </button>
        ) : (
          <kbd
            className="hidden rounded border bg-muted px-1.5 font-mono text-[11px] text-muted-foreground sm:inline"
            aria-hidden
          >
            /
          </kbd>
        )}
      </div>
      <span id="skills-search-hint" className="sr-only">
        Press slash to focus search, Escape to clear.
      </span>
    </div>
  );
}
