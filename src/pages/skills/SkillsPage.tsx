/**
 * Halaman Skills (`/skills`) — jelajah & pasang skill dari skills.sh.
 *
 * - Toolbar: pemilih Project ("Install to") + kolom cari. Project terpilih =
 *   `?project=` (dari sidebar) > pilihan terakhir (localStorage) > satu-
 *   satunya Project. Pilihan memperbarui URL (`replaceState`).
 * - Dua tab memakai kolom cari yang sama, tapi query disimpan per tab:
 *   - Browse: hasil skills.sh (debounce, min. 2 karakter); saat kosong
 *     tampil chip saran kata kunci.
 *   - Installed: skill terpasang di Project (+ global), difilter lokal.
 * - Hasil berupa grid kartu 2 kolom (1 kolom di HP).
 * - Pintasan `/` memfokuskan kolom cari; Esc mengosongkannya.
 * - Install -> dialog konfirmasi (audit keamanan) -> job instalasi di latar
 *   (`lib/skill-installs`). Progres + output CLI tampil di notifikasi global;
 *   kartu menunjukkan "Installing…" dan daftar terpasang dimuat ulang saat
 *   job sukses.
 */
import { FolderPlusIcon, SearchIcon, SparklesIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InstallSkillDialog } from "@/components/skills/InstallSkillDialog";
import {
  InstalledSkillCard,
  RegistrySkillCard,
  SkillCardSkeleton,
  SkillGrid,
} from "@/components/skills/SkillCards";
import { SkillsProjectPicker } from "@/components/skills/SkillsProjectPicker";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useRouter } from "@/hooks/useRouter";
import { ApiError, apiFetch } from "@/lib/api";
import { parseSkillsProject, projectsPath, skillsPath } from "@/lib/routes";
import {
  findRunningInstall,
  onInstallFinished,
  revealInstall,
  startInstall,
  useInstalls,
} from "@/lib/skill-installs";
import {
  installedProjectSkillNames,
  isInstalled,
  LAST_SKILLS_PROJECT_KEY,
  resolveSkillsProject,
  SEARCH_SUGGESTIONS,
  visibleInstalledSkills,
} from "@/lib/skills-catalog";
import { cn } from "@/lib/utils";
import type { SkillInfo } from "@/server/services/opencode-client";
import type { RegistrySkill } from "@/server/services/skills-registry";
import type { Project } from "@/types";

/** Jeda ketik sebelum memanggil skills.sh. */
const SEARCH_DEBOUNCE_MS = 350;
const MIN_QUERY = 2;

type Tab = "browse" | "installed";

type Load<T> =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; data: T };

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

function readStoredProject(): string | null {
  try {
    return localStorage.getItem(LAST_SKILLS_PROJECT_KEY);
  } catch {
    return null;
  }
}

function storeProject(id: string): void {
  try {
    localStorage.setItem(LAST_SKILLS_PROJECT_KEY, id);
  } catch {
    // Storage tidak tersedia (mode privat) — cukup URL.
  }
}

export function SkillsPage() {
  const { pathname, navigate } = useRouter();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [urlProjectId, setUrlProjectId] = useState<string | null>(() =>
    parseSkillsProject(window.location.search),
  );

  // Sinkron dengan URL saat navigasi SPA ke /skills?project=... dari sidebar.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname jadi trigger navigasi
  useEffect(() => {
    setUrlProjectId(parseSkillsProject(window.location.search));
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/projects")
      .then((res) => res.json() as Promise<{ projects: Project[] }>)
      .then(({ projects }) => {
        if (!cancelled) setProjects(projects);
      })
      .catch((e) => {
        if (!cancelled) {
          setProjects([]);
          setProjectsError(errorMessage(e, "Failed to load projects"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = useMemo(
    () => (projects ? resolveSkillsProject(projects, urlProjectId, readStoredProject()) : null),
    [projects, urlProjectId],
  );

  // Pilihan hasil fallback (tersimpan / satu-satunya) ikut ditulis ke URL.
  useEffect(() => {
    if (selected && selected.id !== urlProjectId) {
      window.history.replaceState({}, "", skillsPath(selected.id));
      setUrlProjectId(selected.id);
    }
  }, [selected, urlProjectId]);

  const choose = useCallback((id: string) => {
    storeProject(id);
    setUrlProjectId(id);
    window.history.replaceState({}, "", skillsPath(id));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Skills</h1>
        <p className="text-sm text-muted-foreground">
          Discover skills on{" "}
          <a
            href="https://skills.sh"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline underline-offset-4"
          >
            skills.sh
            <span className="sr-only"> (opens in a new tab)</span>
          </a>{" "}
          and add them to your project's agent.
        </p>
      </header>

      {projects === null ? (
        <div className="flex flex-col gap-3 sm:flex-row">
          <Skeleton className="h-15 w-full rounded-xl sm:w-80" />
          <Skeleton className="h-15 flex-1 rounded-xl" />
        </div>
      ) : projects.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderPlusIcon />
            </EmptyMedia>
            <EmptyTitle>No projects yet</EmptyTitle>
            <EmptyDescription>
              {projectsError ?? "Skills are installed per project. Create a project first."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button type="button" onClick={() => navigate(projectsPath())}>
              Go to projects
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        // Remount per Project: pencarian & daftar terpasang tidak bocor.
        <SkillsWorkspace
          key={selected?.id ?? "none"}
          projects={projects}
          project={selected}
          onSelectProject={choose}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface SkillsWorkspaceProps {
  projects: Project[];
  project: Project | null;
  onSelectProject: (id: string) => void;
}

function SkillsWorkspace({ projects, project, onSelectProject }: SkillsWorkspaceProps) {
  const [tab, setTab] = useState<Tab>("browse");
  /**
   * Query per tab: Browse mencari skills.sh (remote), Installed memfilter
   * lokal — memakai satu query bersama membuat tab lain ikut terfilter.
   */
  const [queries, setQueries] = useState<Record<Tab, string>>({ browse: "", installed: "" });
  const query = queries[tab];
  const setQuery = useCallback((q: string) => setQueries((prev) => ({ ...prev, [tab]: q })), [tab]);
  const [installed, setInstalled] = useState<Load<SkillInfo[]>>({ phase: "idle" });
  const [reloadKey, setReloadKey] = useState(0);
  const [results, setResults] = useState<Load<RegistrySkill[]>>({ phase: "idle" });
  /** Permintaan pencarian sedang berjalan (hasil lama tetap tampil). */
  const [searchBusy, setSearchBusy] = useState(false);
  const [pending, setPending] = useState<RegistrySkill | null>(null);
  /** Permintaan memulai instalasi sedang dikirim (job belum dibuat). */
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const installs = useInstalls();
  const searchRef = useRef<HTMLInputElement>(null);

  // Pintasan `/` memfokuskan kolom cari (kecuali sedang mengetik di input lain).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Skill terpasang (dibaca dari server headless opencode Project).
  useEffect(() => {
    void reloadKey;
    if (!project) return;
    let cancelled = false;
    setInstalled((prev) => (prev.phase === "ready" ? prev : { phase: "loading" }));
    apiFetch(`/api/projects/${project.id}/skills`)
      .then((res) => res.json() as Promise<{ skills: SkillInfo[] }>)
      .then(({ skills }) => {
        if (!cancelled) setInstalled({ phase: "ready", data: skills });
      })
      .catch((e) => {
        if (!cancelled) {
          setInstalled({ phase: "error", message: errorMessage(e, "Failed to load skills") });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [project, reloadKey]);

  // Pencarian skills.sh dengan debounce; respon usang dibuang. Hasil lama
  // tetap tampil selama query baru dimuat (spinner di kolom cari).
  const trimmed = query.trim();
  const browseQuery = queries.browse.trim();
  const canSearch = browseQuery.length >= MIN_QUERY;
  useEffect(() => {
    if (!canSearch) {
      setResults({ phase: "idle" });
      setSearchBusy(false);
      return;
    }
    let cancelled = false;
    setResults((prev) => (prev.phase === "ready" ? prev : { phase: "loading" }));
    setSearchBusy(true);
    const timer = setTimeout(() => {
      apiFetch(`/api/skills/search?${new URLSearchParams({ q: browseQuery })}`)
        .then((res) => res.json() as Promise<{ skills: RegistrySkill[] }>)
        .then(({ skills }) => {
          if (!cancelled) setResults({ phase: "ready", data: skills });
        })
        .catch((e) => {
          if (!cancelled) setResults({ phase: "error", message: errorMessage(e, "Search failed") });
        })
        .finally(() => {
          if (!cancelled) setSearchBusy(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [browseQuery, canSearch]);

  const installedNames = useMemo(
    () =>
      installed.phase === "ready" ? installedProjectSkillNames(installed.data) : new Set<string>(),
    [installed],
  );
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
  const install = async (skill: RegistrySkill) => {
    if (!project) return;
    setStarting(true);
    setStartError(null);
    try {
      await startInstall(project.id, skill.source, skill.skillId);
      setPending(null);
    } catch (e) {
      // Dialog tetap terbuka agar user melihat alasannya.
      setStartError(errorMessage(e, "Failed to start the installation."));
    } finally {
      setStarting(false);
    }
  };

  const placeholder =
    tab === "browse" ? "Search skills.sh — e.g. react, testing, docs" : "Filter installed skills";

  return (
    <div className="flex flex-col gap-5">
      {/* Toolbar: tujuan instalasi + pencarian */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <SkillsProjectPicker projects={projects} selected={project} onSelect={onSelectProject} />

        <div className="relative flex min-w-0 flex-1 items-center">
          <SearchIcon
            className="pointer-events-none absolute left-3.5 size-4 text-muted-foreground"
            aria-hidden
          />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query !== "") {
                e.preventDefault();
                setQuery("");
              }
            }}
            disabled={!project}
            placeholder={project ? placeholder : "Select a project to search"}
            aria-label={tab === "browse" ? "Search skills on skills.sh" : "Filter installed skills"}
            aria-describedby="skills-search-hint"
            className="h-full min-h-11 w-full rounded-xl border bg-card pr-20 pl-10 text-sm shadow-xs outline-none transition-shadow placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 [&::-webkit-search-cancel-button]:hidden"
          />
          <div className="absolute right-2 flex items-center gap-1">
            {searchBusy && tab === "browse" && <Spinner className="size-4 text-muted-foreground" />}
            {query !== "" ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  searchRef.current?.focus();
                }}
                aria-label="Clear search"
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <XIcon className="size-4" />
              </button>
            ) : (
              project && (
                <kbd
                  className="hidden rounded border bg-muted px-1.5 font-mono text-[11px] text-muted-foreground sm:inline"
                  aria-hidden
                >
                  /
                </kbd>
              )
            )}
          </div>
          <span id="skills-search-hint" className="sr-only">
            Press slash to focus search, Escape to clear.
          </span>
        </div>
      </div>

      {!project ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SparklesIcon />
            </EmptyMedia>
            <EmptyTitle>Choose where to install</EmptyTitle>
            <EmptyDescription>
              Skills are added per project. Pick a project above to browse and install skills.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          {/* Tabs */}
          <div role="tablist" aria-label="Skill views" className="flex items-center gap-1 border-b">
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

          <div role="tabpanel" id={`skills-panel-${tab}`} aria-labelledby={`skills-tab-${tab}`}>
            {tab === "browse" ? (
              <BrowsePanel
                query={trimmed}
                canSearch={canSearch}
                results={results}
                installedNames={installedNames}
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
            starting={starting}
            startError={startError}
            onOpenChange={(open) => {
              if (!open) {
                setPending(null);
                setStartError(null);
              }
            }}
            onConfirm={(s) => void install(s)}
          />
        </>
      )}
    </div>
  );
}

function TabButton({
  id,
  current,
  onSelect,
  children,
}: {
  id: Tab;
  current: Tab;
  onSelect: (tab: Tab) => void;
  children: React.ReactNode;
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

// ---------------------------------------------------------------------------

function BrowsePanel({
  query,
  canSearch,
  results,
  installedNames,
  isInstalling,
  onSuggest,
  onInstall,
}: {
  query: string;
  canSearch: boolean;
  results: Load<RegistrySkill[]>;
  installedNames: ReadonlySet<string>;
  /** Id job instalasi berjalan untuk skill ini (null bila tidak ada). */
  isInstalling: (skill: RegistrySkill) => string | null;
  onSuggest: (q: string) => void;
  onInstall: (skill: RegistrySkill) => void;
}) {
  if (!canSearch) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed px-6 py-10 text-center">
        <span className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <SearchIcon className="size-5" aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">
            {query.length === 1 ? "Keep typing…" : "Search the skills.sh directory"}
          </p>
          <p className="text-sm text-muted-foreground">
            Type at least 2 characters, or start with a popular topic.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {SEARCH_SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSuggest(s)}
              className="rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (results.phase === "idle" || results.phase === "loading") return <SkillCardSkeleton />;
  if (results.phase === "error") {
    return (
      <p
        role="alert"
        className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
      >
        {results.message}
      </p>
    );
  }
  if (results.data.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchIcon />
          </EmptyMedia>
          <EmptyTitle>No skills found</EmptyTitle>
          <EmptyDescription>
            Nothing on skills.sh matches “{query}”. Try a broader keyword.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <section aria-label="Search results" className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {results.data.length} {results.data.length === 1 ? "result" : "results"} for “{query}” ·
        sorted by installs
      </p>
      <SkillGrid label="Skills on skills.sh">
        {results.data.map((skill) => {
          const jobId = isInstalling(skill);
          return (
            <RegistrySkillCard
              key={skill.id}
              skill={skill}
              installed={isInstalled(skill, installedNames)}
              installing={jobId !== null}
              onInstall={onInstall}
              onShowProgress={() => {
                if (jobId) revealInstall(jobId);
              }}
            />
          );
        })}
      </SkillGrid>
    </section>
  );
}

function InstalledPanel({
  state,
  skills,
  total,
  query,
  onBrowse,
}: {
  state: Load<SkillInfo[]>;
  skills: SkillInfo[];
  total: number;
  query: string;
  onBrowse: () => void;
}) {
  if (state.phase === "idle" || state.phase === "loading") return <SkillCardSkeleton />;
  if (state.phase === "error") {
    return (
      <p
        role="alert"
        className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
      >
        {state.message}
      </p>
    );
  }

  if (total === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SparklesIcon />
          </EmptyMedia>
          <EmptyTitle>No skills installed yet</EmptyTitle>
          <EmptyDescription>
            Browse skills.sh to add your first skill to this project.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button type="button" variant="outline" onClick={onBrowse}>
            <SearchIcon data-icon="inline-start" />
            Browse skills
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  if (skills.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No installed skills match “{query}”.
      </p>
    );
  }

  return (
    <section aria-label="Installed skills" className="flex flex-col gap-3">
      {query !== "" && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {skills.length} of {total} installed skills
        </p>
      )}
      <SkillGrid label="Installed skills">
        {skills.map((skill) => (
          <InstalledSkillCard key={`${skill.source}:${skill.name}`} skill={skill} />
        ))}
      </SkillGrid>
    </section>
  );
}
