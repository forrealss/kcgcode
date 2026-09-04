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
      <div className="flex flex-col gap-6">
        <Skeleton className="h-[68px] w-full rounded-xl" />
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-8 w-28 rounded-md" />
          </div>
          <Skeleton className="h-[68px] w-full rounded-xl" />
          <Skeleton className="h-[68px] w-full rounded-xl" />
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
          Kembali ke daftar Project
        </a>
      </div>
    );
  }

  return (
    <SessionList
      key={state.project.id}
      project={state.project}
      onOpenSession={(session) => navigate(sessionPath(projectId, session.id))}
      onBack={() => navigate(projectsPath())}
      // Project sudah tidak ada — halaman ini tak punya data lagi untuk
      // ditampilkan, jadi langsung kembali ke daftar Project.
      onDeleted={() => navigate(projectsPath())}
    />
  );
}
