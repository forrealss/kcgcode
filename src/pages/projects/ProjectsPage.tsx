/**
 * Homepage (`/`): daftar Project sebagai fokus utama.
 *
 * Pengguna datang ke sini untuk melanjutkan pekerjaan, jadi daftar Project
 * tampil lebih dulu dan setiap baris dapat langsung diklik. Bila Project sudah
 * punya Session, tombol "Lanjutkan" melompat ke Session yang terakhir
 * disentuh tanpa mampir ke halaman Project. Bila belum ada Project sama
 * sekali, empty state mengarahkan ke pembuatan Project (`NewProjectDialog`).
 *
 * Ringkasan per Project (jumlah Session, Session berjalan, aktivitas
 * terakhir) dihitung `lib/project-overview.ts` dari `GET /api/projects` +
 * `GET /api/sessions` — logika murni dan teruji, komponen ini hanya merender.
 */

import {
  ArrowRightIcon,
  FolderPlusIcon,
  FoldersIcon,
  RefreshCwIcon,
  SearchIcon,
  SearchXIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { NewProjectDialog } from "@/components/projects/NewProjectDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useRouter } from "@/hooks/useRouter";
import { ApiError, apiFetch } from "@/lib/api";
import {
  buildProjectOverviews,
  filterProjectOverviews,
  formatRelativeTime,
  type ProjectOverview,
  totalRunningSessions,
} from "@/lib/project-overview";
import { projectPath, sessionPath } from "@/lib/routes";
import type { Project, Session } from "@/types";
import logo from "../../logo.svg";

/** Ambang jumlah Project sebelum kolom pencarian ditampilkan. */
const SEARCH_THRESHOLD = 5;

export function ProjectsPage() {
  const { navigate } = useRouter();
  const [overviews, setOverviews] = useState<ProjectOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [query, setQuery] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // Session dimuat bersamaan supaya tiap baris bisa menampilkan status &
      // target "Lanjutkan" tanpa request tambahan per Project.
      const [projectsRes, sessionsRes] = await Promise.all([
        apiFetch("/api/projects"),
        apiFetch("/api/sessions"),
      ]);
      const [{ projects }, { sessions }] = (await Promise.all([
        projectsRes.json(),
        sessionsRes.json(),
      ])) as [{ projects: Project[] }, { sessions: Session[] }];
      setOverviews(buildProjectOverviews(projects, sessions));
    } catch (e) {
      setOverviews([]);
      setLoadError(e instanceof ApiError ? e.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visible = useMemo(() => filterProjectOverviews(overviews, query), [overviews, query]);
  const running = totalRunningSessions(overviews);
  const showSearch = overviews.length >= SEARCH_THRESHOLD;

  /** Buka Session terakhir bila ada, jika tidak ke halaman Project. */
  const resume = (overview: ProjectOverview) => {
    const { project, lastSession } = overview;
    navigate(
      lastSession === null ? projectPath(project.id) : sessionPath(project.id, lastSession.id),
    );
  };

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 lg:max-w-2xl">
      {/* Branding ringkas — daftar Project yang jadi fokus, bukan hero besar */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-foreground p-2 shadow-sm dark:bg-card dark:ring-1 dark:ring-border">
            <img src={logo} alt="" className="size-full" />
          </span>
          <div className="flex min-w-0 flex-col">
            <h1 className="truncate text-lg font-semibold tracking-tight">KCG Bridge</h1>
            <p className="truncate text-xs text-muted-foreground">
              {running > 0
                ? `${running} session${running === 1 ? "" : "s"} running`
                : "Control CLI_Agent from anywhere"}
            </p>
          </div>
        </div>
        <Button type="button" onClick={() => setDialogOpen(true)} className="shrink-0 shadow-sm">
          <FolderPlusIcon data-icon="inline-start" />
          <span className="hidden sm:inline">New project</span>
          <span className="sm:hidden">New</span>
        </Button>
      </div>

      <NewProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} onCreated={refresh} />

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium text-muted-foreground">Project</h2>
            {!loading && !loadError && overviews.length > 0 && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {overviews.length}
              </span>
            )}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => void refresh()}
                aria-label="Reload project list"
                disabled={loading}
              >
                <RefreshCwIcon className={loading ? "animate-spin" : undefined} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reload</TooltipContent>
          </Tooltip>
        </div>

        {showSearch && (
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or path…"
              aria-label="Search projects"
              className="pl-9"
            />
          </div>
        )}

        {loading ? (
          <ProjectListSkeleton />
        ) : loadError ? (
          <Alert variant="destructive">
            <AlertTitle>Failed to load projects</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        ) : overviews.length === 0 ? (
          <Empty className="rounded-xl border border-dashed bg-card">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FoldersIcon />
              </EmptyMedia>
              <EmptyTitle>No projects yet</EmptyTitle>
              <EmptyDescription>
                Add a project first — pick a working directory in the Sandbox, then run CLI_Agent
                inside it.
              </EmptyDescription>
              <EmptyContent>
                <Button type="button" onClick={() => setDialogOpen(true)}>
                  <FolderPlusIcon data-icon="inline-start" />
                  Add project
                </Button>
              </EmptyContent>
            </EmptyHeader>
          </Empty>
        ) : visible.length === 0 ? (
          <Empty className="rounded-xl border border-dashed bg-card">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchXIcon />
              </EmptyMedia>
              <EmptyTitle>No matches</EmptyTitle>
              <EmptyDescription>No project with name or path “{query.trim()}”.</EmptyDescription>
              <EmptyContent>
                <Button type="button" variant="outline" onClick={() => setQuery("")}>
                  Clear search
                </Button>
              </EmptyContent>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {visible.map((overview) => (
              <li key={overview.project.id}>
                <ProjectRow overview={overview} onOpen={() => resume(overview)} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

interface ProjectRowProps {
  overview: ProjectOverview;
  onOpen: () => void;
}

/**
 * Satu baris Project. Seluruh baris adalah tombol tunggal (bukan tombol di
 * dalam tombol) agar target sentuh besar di layar HP dan tetap dapat diakses
 * lewat keyboard.
 */
function ProjectRow({ overview, onOpen }: ProjectRowProps) {
  const { project, sessionCount, runningCount, lastSession, lastActivityAt } = overview;
  const hasSession = lastSession !== null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left shadow-sm transition-all hover:border-primary/40 hover:bg-accent hover:shadow-md focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      aria-label={
        hasSession ? `Resume last session of ${project.name}` : `Open project ${project.name}`
      }
    >
      <span className="relative flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-semibold text-primary uppercase">
        {project.name.trim().charAt(0) || "?"}
        {runningCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-emerald-500 ring-2 ring-card"
            aria-hidden
          />
        )}
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium group-hover:text-primary">
          {project.name}
        </span>
        <span className="truncate font-mono text-xs text-muted-foreground">{project.path}</span>
        <span className="truncate text-xs text-muted-foreground">
          {sessionCount === 0
            ? "No sessions"
            : `${sessionCount} session${sessionCount === 1 ? "" : "s"}`}
          {runningCount > 0 && ` · ${runningCount} running`}
          {" · "}
          {formatRelativeTime(lastActivityAt)}
        </span>
      </span>

      <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground group-hover:text-primary">
        <span className="hidden sm:inline">{hasSession ? "Resume" : "Open"}</span>
        <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </button>
  );
}

/** Placeholder daftar saat memuat — menjaga tinggi konten agar tidak melompat. */
function ProjectListSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3">
          <Skeleton className="size-10 shrink-0 rounded-lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="size-4 shrink-0 rounded" />
        </div>
      ))}
    </div>
  );
}
