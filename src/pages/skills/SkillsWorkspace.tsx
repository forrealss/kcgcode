/**
 * Area kerja halaman Skills untuk satu Project: tab Browse / Installed dengan
 * kolom cari bersama (query disimpan per tab), daftar skill terpasang dari
 * kedua agent, dan dialog Install -> job instalasi di latar.
 */
import { SparklesIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InstallSkillDialog } from "@/components/skills/InstallSkillDialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useAgentLists } from "@/hooks/useAgentLists";
import { describeFailedAgents } from "@/lib/agent-lists";
import { errorText } from "@/lib/api";
import type { IdleLoad } from "@/lib/load-state";
import {
  findRunningInstall,
  onInstallFinished,
  startInstall,
  useInstalls,
} from "@/lib/skill-installs";
import {
  type InstalledSkill,
  installedAgentsFor,
  mergeInstalledSkills,
  visibleInstalledSkills,
} from "@/lib/skills-catalog";
import type { RegistrySkill } from "@/server/services/skills-registry";
import type { AgentType, Project, SkillInfo } from "@/types";
import { BrowsePanel } from "./BrowsePanel";
import { SearchField, type Tab, TabButton } from "./controls";
import { InstalledPanel } from "./InstalledPanel";
import { useSkillSearch } from "./useSkillSearch";
import { useSlashFocus } from "./useSlashFocus";

const EMPTY_INSTALLED: InstalledSkill[] = [];

export interface SkillsWorkspaceProps {
  project: Project | null;
}

export function SkillsWorkspace({ project }: SkillsWorkspaceProps) {
  const [tab, setTab] = useState<Tab>("browse");
  /**
   * Query per tab: Browse mencari skills.sh (remote), Installed memfilter
   * lokal — memakai satu query bersama membuat tab lain ikut terfilter.
   */
  const [queries, setQueries] = useState<Record<Tab, string>>({ browse: "", installed: "" });
  const query = queries[tab];
  const setQuery = useCallback((q: string) => setQueries((prev) => ({ ...prev, [tab]: q })), [tab]);
  const [reloadKey, setReloadKey] = useState(0);
  const [pending, setPending] = useState<RegistrySkill | null>(null);
  /** Permintaan memulai instalasi sedang dikirim (job belum dibuat). */
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const installs = useInstalls();
  const searchRef = useRef<HTMLInputElement>(null);

  useSlashFocus(searchRef);

  // Skill terpasang dari semua agent (opencode: server headless Project;
  // Claude Code: `.claude/skills` Project + global), dibaca bersamaan lalu
  // digabung. Satu agent gagal tidak menggagalkan yang lain. Saat dimuat
  // ulang, daftar lama tetap tampil.
  const [lists] = useAgentLists<SkillInfo>(
    project ? `/api/projects/${project.id}/skills` : null,
    "skills",
    reloadKey,
    { keepStale: true, fallbackError: "Failed to load skills" },
  );
  const installed = useMemo<IdleLoad<InstalledSkill[]>>(
    () =>
      lists.phase === "ready"
        ? { phase: "ready", data: mergeInstalledSkills(lists.data.byAgent) }
        : lists,
    [lists],
  );
  /** Sebagian agent gagal dibaca (daftar tetap tampil dari agent lain). */
  const failed = lists.phase === "ready" ? lists.data.failed : [];
  const installedWarning =
    failed.length > 0 ? `${describeFailedAgents(failed)} skills: ${failed[0]?.message}` : null;

  // Pencarian skills.sh (tab Browse); query tab aktif dipakai panel.
  const trimmed = query.trim();
  const { results, busy: searchBusy, canSearch } = useSkillSearch(queries.browse);

  const installedList = installed.phase === "ready" ? installed.data : EMPTY_INSTALLED;
  const installedAll = useMemo(
    () => (installed.phase === "ready" ? visibleInstalledSkills(installed.data, "") : []),
    [installed],
  );
  const installedFiltered = useMemo(
    () =>
      installed.phase === "ready" ? visibleInstalledSkills(installed.data, queries.installed) : [],
    [installed, queries.installed],
  );

  // Instalasi (di halaman mana pun) selesai untuk Project ini -> muat ulang
  // daftar terpasang agar kartu berubah menjadi "Installed".
  useEffect(() => {
    if (!project) return;
    return onInstallFinished((job) => {
      if (job.projectId === project.id && job.status === "succeeded") {
        setReloadKey((k) => k + 1);
      }
    });
  }, [project]);

  /** Mulai job instalasi; progres & output tampil di notifikasi global. */
  const install = async (skill: RegistrySkill, agents: AgentType[]) => {
    if (!project) return;
    setStarting(true);
    setStartError(null);
    try {
      await startInstall(project.id, skill.source, skill.skillId, agents);
      setPending(null);
    } catch (e) {
      // Dialog tetap terbuka agar user melihat alasannya.
      setStartError(errorText(e, "Failed to start the installation."));
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {!project ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SparklesIcon />
            </EmptyMedia>
            <EmptyTitle>Choose where to install</EmptyTitle>
            <EmptyDescription>
              Skills are added per project. Pick a project in the top right to browse and install
              skills.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          {/* Tabs, lalu kolom cari untuk tab aktif (Browse = skills.sh,
              Installed = filter lokal). */}
          <div className="flex flex-col gap-4">
            <div
              role="tablist"
              aria-label="Skill views"
              className="flex items-center gap-1 border-b"
            >
              <TabButton id="browse" current={tab} onSelect={setTab}>
                Browse
              </TabButton>
              <TabButton id="installed" current={tab} onSelect={setTab}>
                Installed
                {installed.phase === "ready" && (
                  <span className="rounded-full bg-muted px-1.5 text-[11px] leading-4 tabular-nums text-muted-foreground">
                    {installedAll.length}
                  </span>
                )}
              </TabButton>
            </div>
            <SearchField
              inputRef={searchRef}
              tab={tab}
              value={query}
              onChange={setQuery}
              busy={searchBusy}
            />
          </div>

          <div role="tabpanel" id={`skills-panel-${tab}`} aria-labelledby={`skills-tab-${tab}`}>
            {tab === "browse" ? (
              <BrowsePanel
                query={trimmed}
                canSearch={canSearch}
                results={results}
                installedAgents={(skill) => installedAgentsFor(skill, installedList)}
                isInstalling={(skill) =>
                  findRunningInstall(installs, project.id, skill.source, skill.skillId)?.job.id ??
                  null
                }
                onSuggest={(q) => {
                  setQuery(q);
                  searchRef.current?.focus();
                }}
                onInstall={setPending}
              />
            ) : (
              <InstalledPanel
                state={installed}
                warning={installedWarning}
                skills={installedFiltered}
                total={installedAll.length}
                query={trimmed}
                onBrowse={() => {
                  setTab("browse");
                  searchRef.current?.focus();
                }}
              />
            )}
          </div>

          <InstallSkillDialog
            skill={pending}
            projectName={project.name}
            installedAgents={pending ? installedAgentsFor(pending, installedList) : []}
            starting={starting}
            startError={startError}
            onOpenChange={(open) => {
              if (!open) {
                setPending(null);
                setStartError(null);
              }
            }}
            onConfirm={(s, agents) => void install(s, agents)}
          />
        </>
      )}
    </div>
  );
}
