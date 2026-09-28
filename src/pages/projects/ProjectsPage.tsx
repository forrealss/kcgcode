/**
 * Homepage (`/`).
 *
 * - Sudah ada Project -> chat (`HomeChat`): headline acak + composer dengan
 *   pemilih Project di kiri bawah. Kirim = Session baru di Project terpilih.
 *   Daftar Project & Session-nya ada di sidebar (`AppSidebar`).
 * - Belum ada Project -> empty state dengan satu CTA "New project".
 *
 * Data dimuat `hooks/useProjects.ts`; ringkasan per Project (urutan aktivitas
 * terbaru) dihitung `lib/project-overview.ts`.
 */

import { FolderPlusIcon, FoldersIcon, RefreshCwIcon } from "lucide-react";
import { HomeChat } from "@/components/projects/HomeChat";
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
import { Skeleton } from "@/components/ui/skeleton";
import { useProjects } from "@/hooks/useProjects";
import { notifyDataChanged } from "@/lib/data-events";

export function ProjectsPage() {
  const { overviews, loading, loadError, refresh, dialogOpen, setDialogOpen } = useProjects();

  const onCreated = () => {
    void refresh();
    // Sidebar memuat datanya sendiri — beri tahu agar Project baru muncul.
    notifyDataChanged();
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col">
      <NewProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} onCreated={onCreated} />

      {loading && overviews.length === 0 ? (
        <HomeSkeleton />
      ) : loadError ? (
        <div className="flex flex-1 flex-col justify-center">
          <Alert variant="destructive">
            <AlertTitle>Failed to load projects</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-3">
              {loadError}
              <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
                <RefreshCwIcon data-icon="inline-start" />
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      ) : overviews.length === 0 ? (
        <div className="flex flex-1 flex-col justify-center">
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
                  New project
                </Button>
              </EmptyContent>
            </EmptyHeader>
          </Empty>
        </div>
      ) : (
        <HomeChat overviews={overviews} onNewProject={() => setDialogOpen(true)} />
      )}
    </div>
  );
}

/** Placeholder chat saat memuat — bentuk serupa agar tidak melompat. */
function HomeSkeleton() {
  return (
    <div className="flex flex-1 flex-col justify-center gap-6 pb-[10dvh]" aria-hidden>
      <div className="flex items-center justify-center gap-3">
        <Skeleton className="size-12 rounded-full" />
        <Skeleton className="h-8 w-64" />
      </div>
      <Skeleton className="h-32 w-full rounded-2xl" />
    </div>
  );
}
