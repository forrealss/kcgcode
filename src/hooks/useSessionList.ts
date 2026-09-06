/**
 * Engine halaman daftar Session milik satu Project (`SessionList.tsx`).
 *
 * Mengelola pemuatan daftar (`GET /api/sessions` di-filter per Project),
 * aksi per-Session (stop/start/hapus), serta dialog konfirmasi hapus Project
 * (yang menghapus seluruh Session-nya). Sisa logika form pembuatan Session
 * baru hidup di `NewSessionDialog`.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, apiFetch } from "@/lib/api";
import { type SessionSummary, sortSessions, summarizeSessions } from "@/lib/session-summary";
import type { Session } from "@/types";

export interface UseSessionListOptions {
  projectId: string;
  /** Dipanggil setelah Project dihapus (kembali ke daftar Project). */
  onDeleted?: () => void;
}

export interface SessionListEngine {
  sessions: Session[];
  loading: boolean;
  loadError: string | null;
  /** Session terurut: running -> crashed -> stopped, terbaru di atas. */
  ordered: Session[];
  summary: SessionSummary;
  refresh: () => Promise<void>;

  /** Error aksi (stop/start/hapus) — banner di atas daftar. */
  actionError: string | null;

  // Aksi per-Session
  stopping: string | null;
  stop: (sessionId: string) => Promise<void>;
  starting: string | null;
  start: (sessionId: string) => Promise<void>;
  /** Session yang sedang dihapus (id), untuk spinner di baris. */
  deleting: string | null;
  pendingDelete: Session | null;
  requestDelete: (session: Session) => void;
  cancelDelete: () => void;
  confirmRemove: () => Promise<void>;

  // Hapus Project (beserta seluruh Session-nya)
  projectDeleteOpen: boolean;
  openProjectDelete: () => void;
  closeProjectDelete: () => void;
  deletingProject: boolean;
  confirmRemoveProject: () => Promise<void>;
}

export function useSessionList({ projectId, onDeleted }: UseSessionListOptions): SessionListEngine {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  /** Session yang akan dihapus, dikonfirmasi lewat `AlertDialog`. */
  const [pendingDelete, setPendingDelete] = useState<Session | null>(null);
  /** Konfirmasi hapus Project (beserta seluruh Session-nya). */
  const [projectDeleteOpen, setProjectDeleteOpen] = useState(false);
  const [deletingProject, setDeletingProject] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiFetch("/api/sessions");
      const body = (await res.json()) as { sessions: Session[] };
      setSessions(body.sessions.filter((s) => s.projectId === projectId));
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Failed to load sessions");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Running -> crashed -> stopped, terbaru di atas (lib/session-summary.ts).
  const ordered = useMemo(() => sortSessions(sessions), [sessions]);
  const summary = useMemo(() => summarizeSessions(sessions), [sessions]);

  /** Stop ≠ hapus: POST /stop hanya mengubah status; data tetap ada dan
      bisa dihidupkan kembali lewat aksi Hidupkan (resume). */
  const stop = useCallback(
    async (sessionId: string) => {
      setStopping(sessionId);
      setActionError(null);
      try {
        await apiFetch(`/api/sessions/${sessionId}/stop`, { method: "POST" });
        await refresh();
      } catch (e) {
        setActionError(e instanceof ApiError ? e.message : "Failed to stop session");
      } finally {
        setStopping(null);
      }
    },
    [refresh],
  );

  /** Resume Session stopped/crashed: POST /api/sessions/:id. */
  const start = useCallback(
    async (sessionId: string) => {
      setStarting(sessionId);
      setActionError(null);
      try {
        await apiFetch(`/api/sessions/${sessionId}`, { method: "POST" });
        await refresh();
      } catch (e) {
        setActionError(e instanceof ApiError ? e.message : "Failed to start session");
      } finally {
        setStarting(null);
      }
    },
    [refresh],
  );

  const requestDelete = useCallback((session: Session) => setPendingDelete(session), []);
  const cancelDelete = useCallback(() => setPendingDelete(null), []);

  /**
   * Hapus Session permanen — menghapus juga session (dan riwayat pesannya)
   * di server headless opencode. Dikonfirmasi via `AlertDialog` sebelum
   * eksekusi karena tidak bisa dibatalkan.
   */
  const confirmRemove = useCallback(async () => {
    const session = pendingDelete;
    if (!session) return;
    setDeleting(session.id);
    setActionError(null);
    try {
      await apiFetch(`/api/sessions/${session.id}`, { method: "DELETE" });
      setPendingDelete(null);
      await refresh();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Failed to delete session");
    } finally {
      setDeleting(null);
    }
  }, [pendingDelete, refresh]);

  const openProjectDelete = useCallback(() => setProjectDeleteOpen(true), []);
  const closeProjectDelete = useCallback(() => setProjectDeleteOpen(false), []);

  /**
   * Hapus pendaftaran Project. Server membersihkan seluruh Session (termasuk
   * sesi remote opencode) lebih dulu; direktori kerja di filesystem tetap ada.
   */
  const confirmRemoveProject = useCallback(async () => {
    setDeletingProject(true);
    setActionError(null);
    try {
      await apiFetch(`/api/projects/${projectId}`, { method: "DELETE" });
      setProjectDeleteOpen(false);
      onDeleted?.();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Failed to delete project");
    } finally {
      setDeletingProject(false);
    }
  }, [onDeleted, projectId]);

  return {
    sessions,
    loading,
    loadError,
    ordered,
    summary,
    refresh,
    actionError,
    stopping,
    stop,
    starting,
    start,
    deleting,
    pendingDelete,
    requestDelete,
    cancelDelete,
    confirmRemove,
    projectDeleteOpen,
    openProjectDelete,
    closeProjectDelete,
    deletingProject,
    confirmRemoveProject,
  };
}
