/**
 * Grup "Skills" panel samping Project: skill dari kedua agent digabung per
 * nama, cari (bila banyak) + filter asal, "Show more", reload skill di agent.
 */
import { PlusIcon, RefreshCwIcon, SparklesIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ActionRow, ExpanderRow, PrefsGroup, RowBadge } from "@/components/settings/prefs";
import { AgentBadges } from "@/components/skills/SkillCards";
import { AdwToggleGroup } from "@/components/ui/adw-toggle-group";
import { SearchEntry } from "@/components/ui/search-entry";
import { useRouter } from "@/hooks/useRouter";
import type { AgentLists } from "@/lib/agent-lists";
import { AGENT_TYPE_LABELS, AGENT_TYPES, agentQuery } from "@/lib/agent-types";
import { apiFetch, errorText } from "@/lib/api";
import type { Load } from "@/lib/load-state";
import { filterSkills, groupSkills } from "@/lib/project-extensions";
import { skillsPath } from "@/lib/routes";
import { type InstalledSkill, mergeInstalledSkills } from "@/lib/skills-catalog";
import { cn } from "@/lib/utils";
import type { AgentType, SkillInfo, SkillSource } from "@/types";
import { ErrorRow, FlatIconButton, PartialFailureRow, SkeletonRows } from "./rows";

/** Skill ditampilkan terbatas dulu; sisanya lewat "Show more". */
const SKILL_PREVIEW = 5;
/** Kolom cari muncul hanya bila skill cukup banyak. */
const SKILL_SEARCH_THRESHOLD = 8;

type SkillFilter = "all" | SkillSource;

const SKILL_FILTER_LABEL: Record<SkillFilter, string> = {
  all: "All",
  project: "Project",
  global: "Global",
  builtin: "Built-in",
};

/**
 * Muat ulang skill di tiap agent tanpa restart (Claude Code `reloadSkills`
 * di proses yang hidup; opencode me-reload instance — ditunda selama ada
 * balasan berjalan). `deferred` = agent yang reload-nya ditunda.
 */
async function reloadAgentSkills(projectId: string): Promise<{ deferred: AgentType[] }> {
  const results = await Promise.all(
    AGENT_TYPES.map(async (agent) => {
      const res = await apiFetch(`/api/projects/${projectId}/skills/reload${agentQuery(agent)}`, {
        method: "POST",
      });
      const body = (await res.json()) as { refreshed?: boolean };
      return { agent, refreshed: body.refreshed !== false };
    }),
  );
  return { deferred: results.filter((r) => !r.refreshed).map((r) => r.agent) };
}

export function SkillsGroup({
  state,
  projectId,
  onReloaded,
}: {
  state: Load<AgentLists<SkillInfo>>;
  projectId: string;
  /** Skill dimuat ulang di agent -> muat ulang daftar. */
  onReloaded: () => void;
}) {
  const { navigate } = useRouter();
  const [reloading, setReloading] = useState(false);
  const reload = async () => {
    setReloading(true);
    try {
      const { deferred } = await reloadAgentSkills(projectId);
      toast.success(
        deferred.length === 0
          ? "Skills reloaded"
          : `Skills reloaded. ${deferred.map((a) => AGENT_TYPE_LABELS[a]).join(", ")} picks them up after the current reply.`,
      );
    } catch (e) {
      toast.error(errorText(e, "Couldn't reload skills."));
    } finally {
      setReloading(false);
      onReloaded();
    }
  };
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
        <div className="flex items-center">
          <FlatIconButton
            label="Reload skills"
            onClick={() => void reload()}
            disabled={reloading || state.phase === "loading"}
          >
            <RefreshCwIcon className={cn(reloading && "animate-spin")} />
          </FlatIconButton>
          <FlatIconButton label="Browse and install skills" onClick={browse}>
            <PlusIcon />
          </FlatIconButton>
        </div>
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
