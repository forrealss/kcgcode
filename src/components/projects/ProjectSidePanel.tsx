/**
 * Panel samping halaman Project — Instructions, MCP server, dan Skills dalam
 * satu kolom di kanan daftar Session.
 *
 * Gaya libadwaita (GNOME Settings), memakai primitif `settings/prefs`:
 * tiap seksi = AdwPreferencesGroup (judul + deskripsi di luar kotak, aksi
 * datar di kanan judul) berisi "boxed list". Baris = AdwActionRow /
 * AdwExpanderRow; kolom cari & filter (GtkSearchEntry, AdwToggleGroup) ada di
 * antara judul dan kotak.
 *
 * MCP & Skills dibaca dari KEDUA agent (OpenCode & Claude Code) lalu
 * digabung per nama, sama seperti halaman Skills:
 * - MCP: `GET /api/projects/:id/mcp?agent=` — status per agent (logo +
 *   label) di subjudul; yang bermasalah paling atas, error tampil inline.
 *   Server Claude Code dibaca dari config (`.mcp.json`, `~/.claude.json`);
 *   statusnya "Not checked" sampai ada Session Claude Code yang berjalan.
 * - Skills: `GET /api/projects/:id/skills?agent=` — cari (bila banyak) +
 *   filter asal; logo agent yang memuat skill; baris dibuka untuk deskripsi
 *   lengkap & path. Tombol "+" membuka halaman Skills untuk Project ini.
 * Satu agent gagal dibaca tidak menggagalkan yang lain (baris catatan).
 * Tiap seksi memuat datanya sendiri; tombol reload memuat ulang keduanya.
 */
import { PlugIcon, PlusIcon, RefreshCwIcon, SparklesIcon, TriangleAlertIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { ProjectInstructions } from "@/components/projects/ProjectInstructions";
import { AgentLogo } from "@/components/sessions/AgentLogo";
import { ActionRow, ExpanderRow, PrefsGroup, RowBadge } from "@/components/settings/prefs";
import { AgentBadges } from "@/components/skills/SkillCards";
import { AdwToggleGroup } from "@/components/ui/adw-toggle-group";
import { Button } from "@/components/ui/button";
import { SearchEntry } from "@/components/ui/search-entry";
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
} from "@/lib/project-extensions";
import { skillsPath } from "@/lib/routes";
import { type InstalledSkill, mergeInstalledSkills } from "@/lib/skills-catalog";
import { cn } from "@/lib/utils";
import type {
  AgentType,
  McpServerInfo,
  McpServerState,
  Project,
  SkillInfo,
  SkillSource,
} from "@/types";

/** Skill ditampilkan terbatas dulu; sisanya lewat "Show more". */
const SKILL_PREVIEW = 5;
/** Kolom cari muncul hanya bila skill cukup banyak. */
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
    <div className="flex flex-col gap-6">
      <ProjectInstructions project={project} onSaved={onProjectChange} />
      <McpGroup state={mcp} onReload={reload} />
      <SkillsGroup state={skills} projectId={project.id} />
    </div>
  );
}

// ------------------------------------------------------------- shared ----

/** Tombol datar bundar di kanan judul grup (aksi header AdwPreferencesGroup). */
function FlatIconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="size-8 rounded-full text-foreground/80"
    >
      {children}
    </Button>
  );
}

/** Baris placeholder saat memuat — tinggi sama dengan ActionRow. */
function SkeletonRows({ rows }: { rows: number }) {
  return Array.from({ length: rows }, (_, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: placeholder statis
    <li key={i} className="flex min-h-14 flex-col justify-center gap-1.5 px-4 py-2.5" aria-hidden>
      <Skeleton className="h-4" style={{ width: `${60 - i * 12}%` }} />
      <Skeleton className="h-3 w-1/3" />
    </li>
  ));
}

/** Baris error dengan tombol coba lagi. */
function ErrorRow({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <ActionRow
      prefix={<TriangleAlertIcon className="size-[18px] text-destructive" aria-hidden />}
      title="Couldn't load"
      subtitle={message}
      suffix={
        onRetry && (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        )
      }
    />
  );
}

/** Baris catatan bila sebagian agent gagal dibaca. */
function PartialFailureRow({ failed }: { failed: AgentLists<unknown>["failed"] }) {
  if (failed.length === 0) return null;
  return (
    <ActionRow
      prefix={
        <TriangleAlertIcon className="size-[18px] text-amber-600 dark:text-amber-400" aria-hidden />
      }
      title={`Couldn't read ${failed.map((f) => AGENT_TYPE_LABELS[f.agent]).join(", ")}`}
      subtitle={failed[0]?.message}
    />
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

/** Warna ikon baris = status paling bermasalah. */
const MCP_ICON: Record<McpServerState["status"], string> = {
  connected: "text-emerald-600 dark:text-emerald-400",
  failed: "text-destructive",
  needs_auth: "text-amber-600 dark:text-amber-400",
  needs_client_registration: "text-amber-600 dark:text-amber-400",
  disabled: "text-muted-foreground/60",
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

function McpGroup({
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
    <PrefsGroup
      title="MCP servers"
      description={state.phase === "ready" ? describeMcpEntries(entries) : "Loading…"}
      suffix={
        <FlatIconButton
          label="Reload MCP servers and skills"
          onClick={onReload}
          disabled={state.phase === "loading"}
        >
          <RefreshCwIcon className={cn(state.phase === "loading" && "animate-spin")} />
        </FlatIconButton>
      }
    >
      {state.phase === "loading" ? (
        <SkeletonRows rows={2} />
      ) : state.phase === "error" ? (
        <ErrorRow message={state.message} onRetry={onReload} />
      ) : (
        <>
          {entries.length === 0 ? (
            <ActionRow
              title="No MCP servers"
              subtitle={
                <>
                  Add them under <code className="font-mono">mcp</code> in opencode.json, or in{" "}
                  <code className="font-mono">.mcp.json</code> for Claude Code, then reload.
                </>
              }
            />
          ) : (
            entries.map((entry) => <McpRow key={entry.name} entry={entry} />)
          )}
          <PartialFailureRow failed={state.data.failed} />
        </>
      )}
    </PrefsGroup>
  );
}

/**
 * Satu MCP server (AdwActionRow): ikon simbolik berwarna status, nama, lalu
 * status per agent di subjudul — "logo Label" untuk tiap agent pemakai.
 * Error tampil di bawahnya per agent.
 */
function McpRow({ entry }: { entry: McpServerEntry }) {
  const errors = entry.agents
    .map((a) => ({ agent: a, error: entry.byAgent[a]?.error ?? null }))
    .filter((e): e is { agent: AgentType; error: string } => e.error !== null);
  return (
    <ActionRow
      prefix={<PlugIcon className={cn("size-[18px]", MCP_ICON[entry.status])} aria-hidden />}
      title={<span className="block truncate">{entry.name}</span>}
      subtitle={
        <span className="flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            {entry.agents.map((a) => {
              const status = entry.byAgent[a]?.status ?? "unknown";
              const label = mcpAgentLabel(a, status);
              return (
                <span
                  key={a}
                  className={cn("inline-flex items-center gap-1.5", MCP_TEXT[status])}
                  title={
                    a === "claude-code" && status === "unknown"
                      ? "Configured for Claude Code. Status appears once a Claude Code session runs in this project."
                      : `${AGENT_TYPE_LABELS[a]}: ${label}`
                  }
                >
                  <AgentLogo agentType={a} className="size-3" />
                  <span className="sr-only">{AGENT_TYPE_LABELS[a]}:</span>
                  {label}
                </span>
              );
            })}
          </span>
          {errors.map((e) => (
            <span
              key={e.agent}
              className="line-clamp-2 font-mono text-[11.5px] leading-relaxed break-all text-destructive/90"
              title={e.error}
            >
              {entry.agents.length > 1 && `${AGENT_TYPE_LABELS[e.agent]}: `}
              {e.error}
            </span>
          ))}
        </span>
      }
    />
  );
}

// ------------------------------------------------------------- Skills ----

type SkillFilter = "all" | SkillSource;

const SKILL_FILTER_LABEL: Record<SkillFilter, string> = {
  all: "All",
  project: "Project",
  global: "Global",
  builtin: "Built-in",
};

function SkillsGroup({
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
  // Urutan tampil: Project -> global -> bawaan (paling relevan dulu).
  const groups = useMemo(() => groupSkills(all), [all]);
  const ordered = useMemo(() => groups.flatMap((g) => g.skills), [groups]);
  const sources = useMemo(() => groups.map((g) => g.source), [groups]);
  const bySource = useMemo(
    () => (filter === "all" ? ordered : ordered.filter((s) => s.source === filter)),
    [ordered, filter],
  );
  const filtered = useMemo(() => filterSkills(bySource, query), [bySource, query]);
  const searching = query.trim() !== "";
  // Saat mencari, tampilkan semua hasil; selain itu batasi hingga "Show more".
  const visible = searching || expanded ? filtered : filtered.slice(0, SKILL_PREVIEW);
  const hidden = filtered.length - visible.length;
  const browse = () => navigate(skillsPath(projectId));

  const showSearch = all.length >= SKILL_SEARCH_THRESHOLD;
  const showFilter = sources.length > 1;
  const toolbar =
    state.phase === "ready" && (showSearch || showFilter) ? (
      <div className="flex flex-col gap-2">
        {showSearch && (
          <SearchEntry
            value={query}
            onValueChange={setQuery}
            placeholder={`Search ${all.length} skills`}
            aria-label="Search skills"
          />
        )}
        {showFilter && (
          <AdwToggleGroup
            label="Filter skills by source"
            value={filter}
            onChange={(f) => {
              setFilter(f);
              setExpanded(false);
            }}
            options={(["all", ...sources] as SkillFilter[]).map((f) => {
              const count = f === "all" ? all.length : all.filter((s) => s.source === f).length;
              return {
                value: f,
                label: SKILL_FILTER_LABEL[f],
                title: `${SKILL_FILTER_LABEL[f]}: ${count}`,
                ariaLabel: `${SKILL_FILTER_LABEL[f]}, ${count} skills`,
              };
            })}
            className="[&_button]:text-[13px]"
          />
        )}
      </div>
    ) : undefined;

  return (
    <PrefsGroup
      title="Skills"
      description={
        state.phase === "ready"
          ? all.length === 0
            ? "None installed"
            : `${all.length} available${filter !== "all" || searching ? ` · ${filtered.length} shown` : ""}`
          : "Loading…"
      }
      suffix={
        <FlatIconButton label="Browse and install skills" onClick={browse}>
          <PlusIcon />
        </FlatIconButton>
      }
      toolbar={toolbar}
    >
      {state.phase === "loading" ? (
        <SkeletonRows rows={3} />
      ) : state.phase === "error" ? (
        <ErrorRow message={state.message} />
      ) : (
        <>
          {all.length === 0 ? (
            <ActionRow
              prefix={<SparklesIcon className="size-[18px] text-muted-foreground" aria-hidden />}
              title="Browse skills"
              subtitle="Install one from skills.sh for OpenCode, Claude Code, or both"
              onActivate={browse}
            />
          ) : visible.length === 0 ? (
            <li className="px-4 py-4 text-center text-[13px] text-muted-foreground">
              No skills match “{query.trim()}”.
            </li>
          ) : (
            visible.map((s) => (
              <SkillRow key={`${s.source}:${s.name}`} skill={s} showSource={filter === "all"} />
            ))
          )}
          {!searching && filtered.length > SKILL_PREVIEW && (
            <li>
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                className="flex min-h-12 w-full items-center justify-center px-4 text-[15px] transition-colors outline-none hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:ring-inset active:bg-muted"
              >
                {expanded ? "Show less" : `Show ${hidden} more`}
              </button>
            </li>
          )}
          <PartialFailureRow failed={state.data.failed} />
        </>
      )}
    </PrefsGroup>
  );
}

/**
 * Satu skill (AdwExpanderRow): nama (+ label asal), deskripsi 1 baris, logo
 * agent pemakai. Dibuka -> deskripsi lengkap & path SKILL.md.
 */
function SkillRow({ skill, showSource }: { skill: InstalledSkill; showSource: boolean }) {
  const details =
    skill.description || skill.location ? (
      <div className="flex flex-col gap-2">
        {skill.description && (
          <p className="text-[13px] leading-relaxed whitespace-pre-line">{skill.description}</p>
        )}
        {skill.location && (
          <p
            className="truncate font-mono text-[11.5px] text-muted-foreground"
            title={skill.location}
          >
            {skill.location}
          </p>
        )}
      </div>
    ) : undefined;
  return (
    <ExpanderRow
      title={
        <>
          <span className="truncate">{skill.name}</span>
          {showSource && skill.source !== "global" && (
            <RowBadge>{skill.source === "project" ? "Project" : "Built-in"}</RowBadge>
          )}
        </>
      }
      subtitle={skill.description ?? undefined}
      suffix={<AgentBadges agents={skill.agents} size="sm" />}
    >
      {details}
    </ExpanderRow>
  );
}
