/**
 * Homepage: branding, aksi pembuatan Project, dan daftar Project terbaru.
 *
 * Form pembuatan tetap tersedia, tetapi disembunyikan sampai pengguna memilih
 * aksi "Project baru" agar root page tetap fokus dan tidak ramai.
 */

import {
  ArrowRightIcon,
  FolderIcon,
  FolderPlusIcon,
  FoldersIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
import { Spinner } from "@/components/ui/spinner";
import { ApiError, apiFetch } from "@/lib/api";
import type { Project } from "@/server/types";
import logo from "../logo.svg";
import { NewProjectDialog } from "./new-project-dialog";

/** Format singkat tanggal dibuat, konsisten dengan `session-list.tsx`. */
function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export interface ProjectListProps {
  /** Navigasi ke daftar Session milik Project yang dipilih. */
  onOpenProject: (project: Project) => void;
}

export function ProjectList({ onOpenProject }: ProjectListProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiFetch("/api/projects");
      const body = (await res.json()) as { projects: Project[] };
      setProjects(body.projects);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Gagal memuat daftar Project");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-8 px-0 lg:max-w-2xl lg:gap-10">
      <section className="relative flex flex-col items-center gap-5 overflow-hidden rounded-3xl border bg-gradient-to-br from-primary/10 via-card to-card px-6 py-10 text-center shadow-sm sm:py-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 [background-image:radial-gradient(circle_at_1px_1px,var(--color-border)_1px,transparent_0)] [background-size:20px_20px] opacity-40"
        />
        <span className="relative flex size-16 shrink-0 items-center justify-center rounded-2xl bg-foreground p-3 shadow-lg dark:bg-card">
          <img src={logo} alt="" className="size-full" />
        </span>
        <div className="relative flex flex-col gap-1.5">
          <h1 className="text-3xl font-semibold tracking-tight">KCG Bridge</h1>
          <p className="text-sm text-muted-foreground">Kontrol CLI_Agent dari mana saja</p>
        </div>
        <Button
          type="button"
          size="lg"
          onClick={() => setDialogOpen(true)}
          className="relative mt-1 w-full max-w-xs shadow-md"
        >
          <FolderPlusIcon data-icon="inline-start" />
          Project baru
        </Button>
      </section>

      <NewProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} onCreated={refresh} />

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-medium">Project terbaru</h2>
            {!loading && !loadError && projects.length > 0 && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {projects.length}
              </span>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => void refresh()}
            aria-label="Muat ulang project"
            title="Muat ulang"
            disabled={loading}
          >
            <RefreshCwIcon className={loading ? "animate-spin" : undefined} />
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center rounded-xl border bg-card py-10 text-sm text-muted-foreground">
            <Spinner className="mr-2 size-4" />
            Memuat project…
          </div>
        ) : loadError ? (
          <Alert variant="destructive">
            <AlertTitle>Gagal memuat Project</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        ) : projects.length === 0 ? (
          <Empty className="rounded-xl border border-dashed bg-card">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FoldersIcon />
              </EmptyMedia>
              <EmptyTitle>Belum ada project</EmptyTitle>
              <EmptyDescription>
                Buat project pertama untuk mulai mengontrol CLI_Agent.
              </EmptyDescription>
              <EmptyContent>
                <Button type="button" onClick={() => setDialogOpen(true)}>
                  <FolderPlusIcon data-icon="inline-start" />
                  Project baru
                </Button>
              </EmptyContent>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col gap-2">
            {projects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => onOpenProject(project)}
                className="group flex w-full items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left shadow-sm transition-all hover:border-primary/40 hover:bg-accent hover:shadow-md"
                aria-label={`Buka project ${project.name}`}
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <FolderIcon />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium group-hover:text-primary">
                    {project.name}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{project.path}</span>
                </span>
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                  {formatDate(project.createdAt)}
                </span>
                <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
