/**
 * Panel samping halaman Project — gaya Claude Projects: Instructions, MCP
 * server, dan Skills dalam satu kolom di kanan daftar Session.
 *
 * Tiap seksi bisa dilipat (status diingat). Daftar berupa "grouped list"
 * (kotak berdivider) dengan padding simetris — tanpa margin negatif.
 * - MCP: `GET /api/projects/:id/mcp` — ikon, nama, pill status; error
 *   `failed` tampil inline. Yang bermasalah diurutkan paling atas.
 * - Skills: `GET /api/projects/:id/skills` — pencarian (bila banyak) + chip
 *   asal (All / This project / Global / Built-in); deskripsi 1 baris, klik
 *   baris untuk membuka deskripsi lengkap.
 * Tiap seksi memuat datanya sendiri sehingga seksi yang lambat tidak menahan
 * seksi lain. Tombol reload memuat ulang keduanya.
 */
import {
  ChevronDownIcon,
  PlugIcon,
  RefreshCwIcon,
  SearchIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { PanelHint, PanelList, PanelSection } from "@/components/projects/PanelSection";
import { ProjectInstructions } from "@/components/projects/ProjectInstructions";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, apiFetch } from "@/lib/api";
import {
  describeMcpSummary,
  filterSkills,
  groupSkills,
  MCP_STATUS_LABEL,
  SKILL_SOURCE_LABEL,
} from "@/lib/project-extensions";
import { cn } from "@/lib/utils";
import type { McpServerInfo, SkillInfo, SkillSource } from "@/server/services/opencode-client";
import type { Project } from "@/types";

/** Skill ditampilkan terbatas dulu; sisanya lewat "Show more". */
const SKILL_PREVIEW = 5;
/** Kotak cari muncul hanya bila skill cukup banyak. */
const SKILL_SEARCH_THRESHOLD = 8;

type Load<T> =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; data: T };

/** Muat satu endpoint list; `reloadKey` berubah -> muat ulang. */
function useProjectList<T>(url: string, key: string, reloadKey: number): Load<T> {
  const [state, setState] = useState<Load<T>>({ phase: "loading" });
  useEffect(() => {
    // `reloadKey` hanya pemicu muat ulang.
    void reloadKey;
    let cancelled = false;
    setState({ phase: "loading" });
    apiFetch(url)
      .then(async (res) => {
        const body = (await res.json()) as Record<string, T>;
        if (!cancelled) setState({ phase: "ready", data: body[key] as T });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({ phase: "error", message: e instanceof ApiError ? e.message : "Failed to load" });
      });
    return () => {
      cancelled = true;
    };
  }, [url, key, reloadKey]);
  return state;
}

export interface ProjectSidePanelProps {
  project: Project;
  onProjectChange: (project: Project) => void;
}

export function ProjectSidePanel({ project, onProjectChange }: ProjectSidePanelProps) {
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  const mcp = useProjectList<McpServerInfo[]>(`/api/projects/${project.id}/mcp`, "mcp", reloadKey);
  const skills = useProjectList<SkillInfo[]>(
    `/api/projects/${project.id}/skills`,
    "skills",
    reloadKey,
  );

  return (
    <div className="flex flex-col gap-6">
      <ProjectInstructions project={project} onSaved={onProjectChange} />
      <McpSection state={mcp} onReload={reload} />
      <SkillsSection state={skills} />
    </div>
  );
}

function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <PanelList>
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholder statis
        <li key={i} className="flex items-center gap-3 px-3.5 py-3" aria-hidden>
          <Skeleton className="size-7 shrink-0 rounded-md" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5" style={{ width: `${75 - i * 15}%` }} />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </li>
      ))}
    </PanelList>
  );
}

function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-3">
      <p className="min-w-0 text-xs leading-relaxed text-destructive">{message}</p>
      {onRetry && (
        <Button type="button" variant="outline" size="xs" onClick={onRetry} className="shrink-0">
          Retry
        </Button>
      )}
    </div>
  );
}

/** Ikon kotak kecil di awal baris daftar. */
function RowIcon({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-3.5",
        className,
      )}
      aria-hidden
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------- MCP ----

/** Yang butuh perhatian di atas: failed -> needs_* -> connected -> sisanya. */
const MCP_ORDER: Record<McpServerInfo["status"], number> = {
  failed: 0,
  needs_auth: 1,
  needs_client_registration: 1,
  connected: 2,
  unknown: 3,
  disabled: 4,
};

const MCP_PILL: Record<McpServerInfo["status"], string> = {
  connected: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  failed: "bg-destructive/10 text-destructive",
  needs_auth: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  needs_client_registration: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  disabled: "bg-muted text-muted-foreground",
  unknown: "bg-muted text-muted-foreground",
};

function McpSection({ state, onReload }: { state: Load<McpServerInfo[]>; onReload: () => void }) {
  const sorted = useMemo(
    () =>
      state.phase === "ready"
        ? [...state.data].sort(
            (a, b) => MCP_ORDER[a.status] - MCP_ORDER[b.status] || a.name.localeCompare(b.name),
          )
        : [],
    [state],
  );

  return (
    <PanelSection
      id="mcp"
      title="MCP servers"
      meta={state.phase === "ready" ? describeMcpSummary(state.data) : undefined}
      action={
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onReload}
          disabled={state.phase === "loading"}
          aria-label="Reload MCP servers and skills"
          title="Reload"
          className="text-muted-foreground"
        >
          <RefreshCwIcon className={cn(state.phase === "loading" && "animate-spin")} />
        </Button>
      }
    >
      {state.phase === "loading" ? (
        <ListSkeleton rows={2} />
      ) : state.phase === "error" ? (
        <ErrorBox message={state.message} onRetry={onReload} />
      ) : sorted.length === 0 ? (
        <PanelHint>
          No MCP servers yet. Add them under <code className="font-mono">mcp</code> in
          opencode.json, then reload.
        </PanelHint>
      ) : (
        <PanelList>
          {sorted.map((server) => (
            <li key={server.name} className="flex items-start gap-3 px-3.5 py-3">
              <RowIcon
                className={cn(
                  server.status === "connected" &&
                    "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                  server.status === "failed" && "bg-destructive/10 text-destructive",
                )}
              >
                <PlugIcon />
              </RowIcon>
              <div className="flex min-w-0 flex-1 flex-col gap-1 pt-0.5">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium leading-5">{server.name}</span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4",
                      MCP_PILL[server.status],
                    )}
                  >
                    {MCP_STATUS_LABEL[server.status]}
                  </span>
                </div>
                {server.error && (
                  <p
                    className="line-clamp-2 font-mono text-[11px] leading-relaxed break-all text-destructive/90"
                    title={server.error}
                  >
                    {server.error}
                  </p>
                )}
              </div>
            </li>
          ))}
        </PanelList>
      )}
    </PanelSection>
  );
}

// ------------------------------------------------------------- Skills ----

type SkillFilter = "all" | SkillSource;

function SkillsSection({ state }: { state: Load<SkillInfo[]> }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SkillFilter>("all");
  const [expanded, setExpanded] = useState(false);

  const all = state.phase === "ready" ? state.data : [];
  // Urutan tampil: Project -> global -> bawaan (paling relevan dulu).
  const ordered = useMemo(() => groupSkills(all).flatMap((g) => g.skills), [all]);
  const sources = useMemo(() => groupSkills(all).map((g) => g.source), [all]);
  const bySource = useMemo(
    () => (filter === "all" ? ordered : ordered.filter((s) => s.source === filter)),
    [ordered, filter],
  );
  const filtered = useMemo(() => filterSkills(bySource, query), [bySource, query]);
  const searching = query.trim() !== "";
  // Saat mencari, tampilkan semua hasil; selain itu batasi hingga "Show more".
  const visible = searching || expanded ? filtered : filtered.slice(0, SKILL_PREVIEW);
  const hidden = filtered.length - visible.length;

  return (
    <PanelSection
      id="skills"
      title="Skills"
      meta={state.phase === "ready" && all.length > 0 ? all.length : undefined}
    >
      {state.phase === "loading" ? (
        <ListSkeleton rows={3} />
      ) : state.phase === "error" ? (
        <ErrorBox message={state.message} />
      ) : all.length === 0 ? (
        <PanelHint>
          No skills found. Add a <code className="font-mono">SKILL.md</code> under{" "}
          <code className="font-mono">.opencode/skills/</code>.
        </PanelHint>
      ) : (
        <div className="flex flex-col gap-2.5">
          {all.length >= SKILL_SEARCH_THRESHOLD && (
            <div className="relative">
              <SearchIcon
                className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setQuery("")}
                placeholder={`Search ${all.length} skills`}
                aria-label="Search skills"
                className="h-9 w-full rounded-xl border bg-card pr-8 pl-8.5 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-search-cancel-button]:hidden"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="absolute top-1/2 right-2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                >
                  <XIcon className="size-3.5" />
                </button>
              )}
            </div>
          )}

          {sources.length > 1 && (
            <fieldset
              aria-label="Filter skills by source"
              className="m-0 flex flex-wrap gap-1 border-0 p-0"
            >
              {(["all", ...sources] as SkillFilter[]).map((f) => {
                const count = f === "all" ? all.length : all.filter((s) => s.source === f).length;
                const active = filter === f;
                return (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setFilter(f);
                      setExpanded(false);
                    }}
                    className={cn(
                      "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                      active
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {f === "all" ? "All" : SKILL_SOURCE_LABEL[f]}
                    <span className={cn("tabular-nums", active ? "opacity-70" : "opacity-60")}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </fieldset>
          )}

          {visible.length === 0 ? (
            <PanelHint>No skills match "{query.trim()}".</PanelHint>
          ) : (
            <PanelList>
              {visible.map((s) => (
                <SkillRow key={`${s.source}:${s.name}`} skill={s} showSource={filter === "all"} />
              ))}
              {!searching && filtered.length > SKILL_PREVIEW && (
                <li>
                  <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    aria-expanded={expanded}
                    className="flex w-full items-center justify-center gap-1.5 px-3.5 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:bg-muted/50 focus-visible:outline-none"
                  >
                    {expanded ? "Show less" : `Show ${hidden} more`}
                    <ChevronDownIcon
                      className={cn("size-3.5 transition-transform", expanded && "rotate-180")}
                      aria-hidden
                    />
                  </button>
                </li>
              )}
            </PanelList>
          )}
        </div>
      )}
    </PanelSection>
  );
}

/**
 * Satu skill: ikon, nama (+ label asal), deskripsi 1 baris. Klik baris untuk
 * membuka deskripsi lengkap dan path SKILL.md.
 */
function SkillRow({ skill, showSource }: { skill: SkillInfo; showSource: boolean }) {
  const [open, setOpen] = useState(false);
  const expandable = Boolean(skill.description || skill.location);
  return (
    <li>
      <button
        type="button"
        onClick={() => expandable && setOpen((v) => !v)}
        aria-expanded={expandable ? open : undefined}
        disabled={!expandable}
        className="flex w-full items-start gap-3 px-3.5 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none disabled:cursor-default disabled:hover:bg-transparent"
      >
        <RowIcon className={cn(skill.source === "project" && "bg-primary/10 text-primary")}>
          <SparklesIcon />
        </RowIcon>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium leading-5">{skill.name}</span>
            {showSource && skill.source !== "global" && (
              <span className="shrink-0 rounded bg-muted px-1.5 text-[10px] font-medium leading-4 text-muted-foreground">
                {skill.source === "project" ? "Project" : "Built-in"}
              </span>
            )}
          </span>
          {skill.description && (
            <span
              className={cn(
                "text-xs leading-relaxed text-muted-foreground",
                open ? "whitespace-pre-line" : "line-clamp-1",
              )}
            >
              {skill.description}
            </span>
          )}
          {open && skill.location && (
            <span className="mt-1 truncate font-mono text-[11px] text-muted-foreground/80">
              {skill.location}
            </span>
          )}
        </span>
        {expandable && (
          <ChevronDownIcon
            className={cn(
              "mt-1.5 size-3.5 shrink-0 text-muted-foreground/60 transition-transform",
              open && "rotate-180",
            )}
            aria-hidden
          />
        )}
      </button>
    </li>
  );
}
