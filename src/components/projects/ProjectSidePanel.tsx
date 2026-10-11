/**
 * Panel samping halaman Project — gaya Claude Projects: Instructions, MCP
 * server, dan Skills dalam satu kolom di kanan daftar Session.
 *
 * Tiap seksi bisa dilipat (status diingat). Daftar berupa "grouped list"
 * (kotak berdivider) dengan padding simetris — tanpa margin negatif.
 *
 * MCP & Skills dibaca dari KEDUA agent (OpenCode & Claude Code) lalu
 * digabung per nama, sama seperti halaman Skills:
 * - MCP: `GET /api/projects/:id/mcp?agent=` — tiap baris menampilkan status
 *   per agent (logo + label); yang bermasalah diurutkan paling atas, error
 *   `failed` tampil inline. Server Claude Code dibaca dari config
 *   (`.mcp.json`, `~/.claude.json`); statusnya "Not checked" sampai ada
 *   Session Claude Code yang berjalan.
 * - Skills: `GET /api/projects/:id/skills?agent=` — pencarian (bila banyak)
 *   + chip asal (All / This project / Global / Built-in); logo agent yang
 *   memuat skill; klik baris untuk deskripsi lengkap. Tombol "+" membuka
 *   halaman Skills untuk Project ini.
 * Satu agent gagal dibaca tidak menggagalkan yang lain (catatan kecil di
 * seksi). Tiap seksi memuat datanya sendiri; tombol reload memuat ulang
 * keduanya.
 */
import {
  ChevronDownIcon,
  PlugIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { PanelBody, PanelHint, PanelList, PanelSection } from "@/components/projects/PanelSection";
import { ProjectInstructions } from "@/components/projects/ProjectInstructions";
import { AgentLogo } from "@/components/sessions/AgentLogo";
import { AgentBadges } from "@/components/skills/SkillCards";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useRouter } from "@/hooks/useRouter";
import { AGENT_TYPE_LABELS, AGENT_TYPES, agentQuery } from "@/lib/agent-types";
import { ApiError, apiFetch } from "@/lib/api";
import {
  describeMcpEntries,
  filterSkills,
  groupSkills,
  MCP_STATUS_LABEL,
  type McpServerEntry,
  mergeMcpServers,
  SKILL_SOURCE_LABEL,
} from "@/lib/project-extensions";
import { skillsPath } from "@/lib/routes";
import { type InstalledSkill, mergeInstalledSkills } from "@/lib/skills-catalog";
import { cn } from "@/lib/utils";
import type { McpServerInfo, SkillInfo, SkillSource } from "@/server/services/opencode-client";
import type { AgentType, McpServerState, Project } from "@/types";

/** Skill ditampilkan terbatas dulu; sisanya lewat "Show more". */
const SKILL_PREVIEW = 5;
/** Kotak cari muncul hanya bila skill cukup banyak. */
const SKILL_SEARCH_THRESHOLD = 8;

/** Hasil per agent; `failed` = agent yang gagal dibaca (yang lain tetap tampil). */
interface AgentLists<T> {
  byAgent: Partial<Record<AgentType, T[]>>;
  failed: { agent: AgentType; message: string }[];
}

type Load<T> =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; data: T };

/**
 * Muat satu endpoint list untuk setiap agent (`?agent=`) bersamaan.
 * Error hanya bila SEMUA agent gagal. `reloadKey` berubah -> muat ulang.
 */
function useAgentLists<T>(path: string, key: string, reloadKey: number): Load<AgentLists<T>> {
  const [state, setState] = useState<Load<AgentLists<T>>>({ phase: "loading" });
  useEffect(() => {
    // `reloadKey` hanya pemicu muat ulang.
    void reloadKey;
    let cancelled = false;
    setState({ phase: "loading" });
    void Promise.allSettled(
      AGENT_TYPES.map((a) =>
        apiFetch(`${path}${agentQuery(a)}`).then(async (res) => {
          const body = (await res.json()) as Record<string, T[]>;
          return body[key] ?? [];
        }),
      ),
    ).then((results) => {
      if (cancelled) return;
      const data: AgentLists<T> = { byAgent: {}, failed: [] };
      results.forEach((r, i) => {
        const agent = AGENT_TYPES[i] as AgentType;
        if (r.status === "fulfilled") data.byAgent[agent] = r.value;
        else {
          const message = r.reason instanceof ApiError ? r.reason.message : "Failed to load";
          data.failed.push({ agent, message });
        }
      });
      if (data.failed.length === AGENT_TYPES.length) {
        setState({ phase: "error", message: data.failed[0]?.message ?? "Failed to load" });
      } else {
        setState({ phase: "ready", data });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [path, key, reloadKey]);
  return state;
}

export interface ProjectSidePanelProps {
  project: Project;
  onProjectChange: (project: Project) => void;
}

export function ProjectSidePanel({ project, onProjectChange }: ProjectSidePanelProps) {
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  const mcp = useAgentLists<McpServerInfo>(`/api/projects/${project.id}/mcp`, "mcp", reloadKey);
  const skills = useAgentLists<SkillInfo>(
    `/api/projects/${project.id}/skills`,
    "skills",
    reloadKey,
  );

  return (
    <div className="flex flex-col gap-3">
      <ProjectInstructions project={project} onSaved={onProjectChange} />
      <McpSection state={mcp} onReload={reload} />
      <SkillsSection state={skills} projectId={project.id} />
    </div>
  );
}

/** Catatan kecil bila sebagian agent gagal dibaca. */
function PartialFailure({ failed }: { failed: AgentLists<unknown>["failed"] }) {
  if (failed.length === 0) return null;
  return (
    <PanelHint>
      <span className="text-destructive">
        Couldn't read {failed.map((f) => AGENT_TYPE_LABELS[f.agent]).join(", ")}:{" "}
        {failed[0]?.message}
      </span>
    </PanelHint>
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
    <div className="flex items-center justify-between gap-3 bg-destructive/5 px-3.5 py-3">
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

/** Warna teks status MCP per agent. */
const MCP_TEXT: Record<McpServerState["status"], string> = {
  connected: "text-emerald-700 dark:text-emerald-400",
  failed: "text-destructive",
  needs_auth: "text-amber-700 dark:text-amber-400",
  needs_client_registration: "text-amber-700 dark:text-amber-400",
  disabled: "text-muted-foreground",
  unknown: "text-muted-foreground",
};

/**
 * Label status per agent. `unknown` di Claude Code berarti status belum
 * pernah dilaporkan proses `claude` (server dibaca dari config).
 */
function mcpAgentLabel(agent: AgentType, status: McpServerState["status"]): string {
  if (agent === "claude-code" && status === "unknown") return "Not checked";
  return MCP_STATUS_LABEL[status];
}

function McpSection({
  state,
  onReload,
}: {
  state: Load<AgentLists<McpServerInfo>>;
  onReload: () => void;
}) {
  const entries = useMemo(
    () => (state.phase === "ready" ? mergeMcpServers(state.data.byAgent) : []),
    [state],
  );

  return (
    <PanelSection
      id="mcp"
      title="MCP servers"
      icon={<PlugIcon />}
      meta={state.phase === "ready" ? describeMcpEntries(entries) : undefined}
      action={
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onReload}
          disabled={state.phase === "loading"}
          aria-label="Reload MCP servers and skills"
          title="Reload"
          className="size-8 text-muted-foreground"
        >
          <RefreshCwIcon className={cn(state.phase === "loading" && "animate-spin")} />
        </Button>
      }
    >
      {state.phase === "loading" ? (
        <ListSkeleton rows={2} />
      ) : state.phase === "error" ? (
        <ErrorBox message={state.message} onRetry={onReload} />
      ) : (
        <>
          {entries.length === 0 ? (
            <PanelHint>
              No MCP servers yet. Add them under <code className="font-mono">mcp</code> in
              opencode.json, or in <code className="font-mono">.mcp.json</code> for Claude Code,
              then reload.
            </PanelHint>
          ) : (
            <PanelList>
              {entries.map((entry) => (
                <McpRow key={entry.name} entry={entry} />
              ))}
            </PanelList>
          )}
          <PartialFailure failed={state.data.failed} />
        </>
      )}
    </PanelSection>
  );
}

/**
 * Satu MCP server: ikon (warna = status paling bermasalah), nama, lalu
 * status per agent sebagai "logo + label" — mis. OpenCode Connected,
 * Claude Code Not checked. Error tampil di bawahnya per agent.
 */
function McpRow({ entry }: { entry: McpServerEntry }) {
  const errors = entry.agents
    .map((a) => ({ agent: a, error: entry.byAgent[a]?.error ?? null }))
    .filter((e): e is { agent: AgentType; error: string } => e.error !== null);
  return (
    <li className="flex items-start gap-3 px-3.5 py-3">
      <RowIcon
        className={cn(
          entry.status === "connected" &&
            "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
          entry.status === "failed" && "bg-destructive/10 text-destructive",
          (entry.status === "needs_auth" || entry.status === "needs_client_registration") &&
            "bg-amber-500/10 text-amber-700 dark:text-amber-400",
        )}
      >
        <PlugIcon />
      </RowIcon>
      <div className="flex min-w-0 flex-1 flex-col gap-1 pt-0.5">
        <span className="truncate text-sm font-medium leading-5" title={entry.name}>
          {entry.name}
        </span>
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Status per agent">
          {entry.agents.map((a) => {
            const status = entry.byAgent[a]?.status ?? "unknown";
            const label = mcpAgentLabel(a, status);
            return (
              <li
                key={a}
                className={cn("flex items-center gap-1.5 text-xs", MCP_TEXT[status])}
                title={
                  a === "claude-code" && status === "unknown"
                    ? "Configured for Claude Code. Status appears once a Claude Code session runs in this project."
                    : `${AGENT_TYPE_LABELS[a]}: ${label}`
                }
              >
                <AgentLogo agentType={a} className="size-3" />
                <span className="sr-only">{AGENT_TYPE_LABELS[a]}:</span>
                {label}
              </li>
            );
          })}
        </ul>
        {errors.map((e) => (
          <p
            key={e.agent}
            className="line-clamp-2 font-mono text-[11px] leading-relaxed break-all text-destructive/90"
            title={e.error}
          >
            {entry.agents.length > 1 && `${AGENT_TYPE_LABELS[e.agent]}: `}
            {e.error}
          </p>
        ))}
      </div>
    </li>
  );
}

// ------------------------------------------------------------- Skills ----

type SkillFilter = "all" | SkillSource;

function SkillsSection({
  state,
  projectId,
}: {
  state: Load<AgentLists<SkillInfo>>;
  projectId: string;
}) {
  const { navigate } = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SkillFilter>("all");
  const [expanded, setExpanded] = useState(false);

  // Skill yang sama di kedua agent jadi satu baris dengan dua logo.
  const all = useMemo(
    () => (state.phase === "ready" ? mergeInstalledSkills(state.data.byAgent) : []),
    [state],
  );
  const browse = () => navigate(skillsPath(projectId));
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
      icon={<SparklesIcon />}
      meta={
        state.phase === "ready"
          ? all.length === 0
            ? "None found"
            : `${all.length} available`
          : undefined
      }
      action={
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={browse}
          aria-label="Browse and install skills for this project"
          title="Browse skills"
          className="size-8 text-muted-foreground"
        >
          <PlusIcon />
        </Button>
      }
    >
      {state.phase === "loading" ? (
        <ListSkeleton rows={3} />
      ) : state.phase === "error" ? (
        <ErrorBox message={state.message} />
      ) : all.length === 0 ? (
        <>
          <PanelBody className="flex flex-col items-start gap-2.5">
            <p className="text-xs leading-relaxed text-muted-foreground">
              No skills yet. Install one from skills.sh for OpenCode, Claude Code, or both.
            </p>
            <Button type="button" variant="outline" size="sm" onClick={browse}>
              <SparklesIcon data-icon="inline-start" />
              Browse skills
            </Button>
          </PanelBody>
          <PartialFailure failed={state.data.failed} />
        </>
      ) : (
        <div className="flex flex-col">
          {(all.length >= SKILL_SEARCH_THRESHOLD || sources.length > 1) && (
            <PanelBody className="flex flex-col gap-2.5 border-b">
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
                    className="h-9 w-full rounded-lg border bg-background pr-8 pl-8.5 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-search-cancel-button]:hidden"
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
                    const count =
                      f === "all" ? all.length : all.filter((s) => s.source === f).length;
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
            </PanelBody>
          )}

          <PartialFailure failed={state.data.failed} />
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
function SkillRow({ skill, showSource }: { skill: InstalledSkill; showSource: boolean }) {
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
            <span className="ml-auto pl-1">
              <AgentBadges agents={skill.agents} size="sm" />
            </span>
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
