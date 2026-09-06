/**
 * Engine homepage (`ProjectsPage`): daftar Project + ringkasan per Project.
 *
 * `GET /api/projects` + `GET /api/sessions` dimuat bersamaan, lalu
 * ringkasan & pencarian dihitung `lib/project-overview.ts` (murni, teruji).
 * Komponen halaman tinggal merender hasilnya.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, apiFetch } from "@/lib/api";
import {
  buildProjectOverviews,
  filterProjectOverviews,
  type ProjectOverview,
  totalRunningSessions,
} from "@/lib/project-overview";
import type { Project, Session } from "@/types";

/** Ambang jumlah Project sebelum kolom pencarian ditampilkan. */
const SEARCH_THRESHOLD = 5;

export interface UseProjectsResult {
  overviews: ProjectOverview[];
  loading: boolean;
  loadError: string | null;
  refresh: () => Promise<void>;
  /** Hasil pencarian (nama/path) dari `overviews`. */
  visible: ProjectOverview[];
  running: number;
  showSearch: boolean;
  /** Dialog pembuatan Project baru. */
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  query: string;
  setQuery: (query: string) => void;
}

export function useProjects(): UseProjectsResult {
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

  return {
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
  };
}
