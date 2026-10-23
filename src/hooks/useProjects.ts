/**
 * Engine homepage (`ProjectsPage`): daftar Project + ringkasan per Project.
 *
 * `GET /api/projects` + `GET /api/sessions` dimuat bersamaan, lalu
 * ringkasan dihitung `lib/project-overview.ts` (murni, teruji).
 * Komponen halaman tinggal merender hasilnya.
 */
import { useCallback, useEffect, useState } from "react";
import { apiFetch, errorText } from "@/lib/api";
import { buildProjectOverviews, type ProjectOverview } from "@/lib/project-overview";
import type { Project, Session } from "@/types";

export interface UseProjectsResult {
  overviews: ProjectOverview[];
  loading: boolean;
  loadError: string | null;
  refresh: () => Promise<void>;
  /** Dialog pembuatan Project baru. */
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
}

export function useProjects(): UseProjectsResult {
  const [overviews, setOverviews] = useState<ProjectOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

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
      setLoadError(errorText(e, "Failed to load projects"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { overviews, loading, loadError, refresh, dialogOpen, setDialogOpen };
}
