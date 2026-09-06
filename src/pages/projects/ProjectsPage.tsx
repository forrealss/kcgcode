/**
 * Homepage (`/`): daftar Project sebagai fokus utama.
 *
 * Pengguna datang ke sini untuk melanjutkan pekerjaan, jadi daftar Project
 * tampil lebih dulu dan setiap baris dapat langsung diklik. Bila Project sudah
 * punya Session, tombol "Lanjutkan" melompat ke Session yang terakhir
 * disentuh tanpa mampir ke halaman Project. Bila belum ada Project sama
 * sekali, empty state mengarahkan ke pembuatan Project (`NewProjectDialog`).
 *
 * State daftar & pencarian dipegang `hooks/useProjects.ts`; ringkasan per
 * Project dihitung `lib/project-overview.ts` (logika murni dan teruji),
 * sedangkan satu baris Project dirender `components/projects/ProjectRow.tsx`.
 */

import { FolderPlusIcon, FoldersIcon, RefreshCwIcon, SearchIcon, SearchXIcon } from "lucide-react";
import { NewProjectDialog } from "@/components/projects/NewProjectDialog";
import { ProjectRow } from "@/components/projects/ProjectRow";
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
import { useProjects } from "@/hooks/useProjects";
import { useRouter } from "@/hooks/useRouter";
import type { ProjectOverview } from "@/lib/project-overview";
import { projectPath, sessionPath } from "@/lib/routes";
import logo from "../../logo.svg";

export function ProjectsPage() {
  const { navigate } = useRouter();
  const {
    overviews,
    loading,
    loadError,
    refresh,
    visible,
    running,
    showSearch,
    dialogOpen,
    setDialogOpen,
    query,
    setQuery,
  } = useProjects();

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
            <h1 className="truncate text-lg font-semibold tracking-tight">KCG Code</h1>
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
