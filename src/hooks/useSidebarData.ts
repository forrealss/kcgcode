/**
 * Data sidebar aplikasi: seluruh Project + Session, digroup per Project.
 *
 * - `GET /api/projects` + `GET /api/sessions` dimuat bersamaan, lalu
 *   dikelompokkan `lib/sidebar-groups.ts` (murni, teruji).
 * - Dimuat ulang setiap `pathname` berubah, sehingga Session/Project yang
 *   baru dibuat atau dihapus ikut terlihat setelah navigasi.
 * - Judul Session diperbarui live lewat WS mode daftar (`attach("")`) yang
 *   menerima broadcast global `session_title`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { ApiError, apiFetch } from "@/lib/api";
import { onDataChanged } from "@/lib/data-events";
import { groupSessionsByProject, type SidebarProjectGroup } from "@/lib/sidebar-groups";
import type { Project, Session } from "@/types";

export interface UseSidebarDataResult {
  /** Seluruh grup Project + Session (pencarian ada di `SearchDialog`). */
  groups: SidebarProjectGroup[];
  /** Total Project sebelum filter — membedakan "kosong" vs "tidak cocok". */
  projectCount: number;
  /** `true` hanya pada pemuatan pertama (refresh berikutnya tanpa skeleton). */
  initialLoading: boolean;
  loadError: string | null;
  refresh: () => Promise<void>;
}

export function useSidebarData(pathname: string): UseSidebarDataResult {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Abaikan respon lama bila refresh baru sudah dimulai (navigasi cepat). */
  const requestSeq = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++requestSeq.current;
    try {
      const [projectsRes, sessionsRes] = await Promise.all([
        apiFetch("/api/projects"),
        apiFetch("/api/sessions"),
      ]);
      const [p, s] = (await Promise.all([projectsRes.json(), sessionsRes.json()])) as [
        { projects: Project[] },
        { sessions: Session[] },
      ];
      if (seq !== requestSeq.current) return;
      setProjects(p.projects);
      setSessions(s.sessions);
      setLoadError(null);
    } catch (e) {
      if (seq !== requestSeq.current) return;
      setLoadError(e instanceof ApiError ? e.message : "Failed to load sessions");
    } finally {
      if (seq === requestSeq.current) setLoaded(true);
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname sengaja jadi trigger refresh
  useEffect(() => {
    void refresh();
  }, [refresh, pathname]);

  // Perubahan data dari halaman lain (mis. Project baru di homepage).
  useEffect(() => onDataChanged(() => void refresh()), [refresh]);

  const ws = useWebSocket({
    onMessage: (msg) => {
      if (msg.type === "session_title") {
        setSessions((prev) =>
          prev.map((s) => (s.id === msg.sessionId ? { ...s, title: msg.title } : s)),
        );
      }
    },
  });
  useEffect(() => {
    ws.attach("");
    return () => ws.disconnect();
  }, [ws.attach, ws.disconnect]);

  const groups = useMemo(() => groupSessionsByProject(projects, sessions), [projects, sessions]);

  return {
    groups,
    projectCount: projects.length,
    initialLoading: !loaded,
    loadError,
    refresh,
  };
}
