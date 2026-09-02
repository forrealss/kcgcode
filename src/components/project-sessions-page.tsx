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
import { navigate, projectsPath } from "@/hooks/use-route";
import { ApiError, apiErrorMessage, apiFetch } from "@/lib/api";
import type { Project, Session } from "@/server/types";
import { SessionList } from "./session-list";

export interface ProjectSessionsPageProps {
  projectId: string;
  /** Navigasi SPA saat sebuah Session dibuka. */
  onOpenSession: (session: Session) => void;
}

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; code: string }
  | { phase: "ready"; project: Project };

export function ProjectSessionsPage({ projectId, onOpenSession }: ProjectSessionsPageProps) {
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
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        Memuat…
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
      onOpenSession={onOpenSession}
      onBack={() => navigate(projectsPath())}
    />
  );
}
