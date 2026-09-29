/**
 * Halaman daftar Session milik satu Project (`/projects/:projectId`).
 *
 * - `Project` di-resolve dari id di URL via `GET /api/projects` (Requirement
 *   10.8) sehingga halaman dapat di-refresh / diakses langsung (direct link)
 *   tanpa state dari halaman sebelumnya.
 * - Project tidak ditemukan (sudah dihapus / id salah) -> pesan error dengan
 *   aksi kembali ke daftar Project.
 * - Komposisi identik dengan `SessionList`: form pembuatan + daftar.
 */

import { useCallback, useEffect, useState } from "react";
import { SessionList } from "@/components/sessions/SessionList";
import { SessionListSkeleton } from "@/components/sessions/SessionRow";
import { Skeleton } from "@/components/ui/skeleton";
import { useRouter } from "@/hooks/useRouter";
import { ApiError, apiErrorMessage, apiFetch } from "@/lib/api";
import { projectsPath, sessionPath } from "@/lib/routes";
import type { Project } from "@/types";

export interface ProjectDetailPageProps {
  projectId: string;
}

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; code: string }
  | { phase: "ready"; project: Project };

export function ProjectDetailPage({ projectId }: ProjectDetailPageProps) {
  const { navigate } = useRouter();
  const [state, setState] = useState<LoadState>({ phase: "loading" });

  const load = useCallback(async () => {
    setState({ phase: "loading" });
    try {
      const res = await apiFetch("/api/projects");
      const body = (await res.json()) as { projects: Project[] };
      const project = body.projects.find((p) => p.id === projectId);
      if (project === undefined) {
        setState({ phase: "error", code: "PROJECT_NOT_FOUND" });
      } else {
        setState({ phase: "ready", project });
      }
    } catch (e) {
      setState({
        phase: "error",
        code: e instanceof ApiError ? e.code : "INTERNAL_ERROR",
      });
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.phase === "loading") {
    return (
      <div
        className="grid grid-cols-1 gap-x-10 gap-y-8 pt-4 sm:pt-8 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]"
        aria-hidden
      >
        {/* Bentuk sama dengan SessionList: kolom Session + panel samping. */}
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-3 w-64" />
              </div>
              <Skeleton className="h-8 w-28 rounded-full" />
            </div>
            <Skeleton className="h-4 w-36" />
          </div>
          <SessionListSkeleton />
        </div>
        <div className="mb-6 hidden flex-col gap-8 self-start rounded-2xl border bg-muted/30 px-5 py-5 lg:flex">
          {[3, 2, 4].map((rows, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholder statis
            <div key={i} className="flex flex-col gap-2.5">
              <Skeleton className="h-4 w-24" />
              {Array.from({ length: rows }, (_, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: placeholder statis
                <Skeleton key={j} className="h-3.5" style={{ width: `${80 - j * 15}%` }} />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <p className="text-sm text-muted-foreground">{apiErrorMessage(state.code)}</p>
        <a
          href={projectsPath()}
          onClick={(e) => {
            e.preventDefault();
            navigate(projectsPath());
          }}
          className="text-sm font-medium underline underline-offset-4"
        >
          Back to projects
        </a>
      </div>
    );
  }

  return (
    <SessionList
      key={state.project.id}
      project={state.project}
      onOpenSession={(session) => navigate(sessionPath(projectId, session.id))}
      // Project sudah tidak ada — halaman ini tak punya data lagi untuk
      // ditampilkan, jadi langsung kembali ke daftar Project.
      onDeleted={() => navigate(projectsPath())}
    />
  );
}
