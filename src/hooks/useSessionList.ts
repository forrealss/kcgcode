/**
 * Engine halaman daftar Session milik satu Project (`SessionList.tsx`).
 *
 * Mengelola pemuatan daftar (`GET /api/sessions` di-filter per Project),
 * aksi per-Session (stop/start/hapus), serta dialog konfirmasi hapus Project
 * (yang menghapus seluruh Session-nya). Sisa logika form pembuatan Session
 * baru hidup di `NewSessionDialog`.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useResyncOnReconnect } from "@/hooks/useResyncOnReconnect";
import { useWebSocket } from "@/hooks/useWebSocket";
import { ApiError, apiFetch } from "@/lib/api";
import { notifyDataChanged } from "@/lib/data-events";
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
  refresh: (opts?: { silent?: boolean }) => Promise<void>;

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
  const [stopping, setStopping] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  /** Session yang akan dihapus, dikonfirmasi lewat `AlertDialog`. */
  const [pendingDelete, setPendingDelete] = useState<Session | null>(null);
  /** Konfirmasi hapus Project (beserta seluruh Session-nya). */
  const [projectDeleteOpen, setProjectDeleteOpen] = useState(false);
  const [deletingProject, setDeletingProject] = useState(false);

  /** `silent`: muat ulang di latar (tanpa skeleton) — sinkron dari server. */
  const refresh = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!silent) setLoading(true);
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
    },
    [projectId],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Judul Session dibuat otomatis oleh opencode SETELAH prompt pertama —
   * daftar yang dimuat saat halaman dibuka belum memuatnya. Satu koneksi WS
   * mode daftar (`attach("")`, tanpa history) menerima broadcast
   * `session_title`, `session_status`, dan `session_deleted` agar baris
   * terkait terbarui live tanpa refresh manual.
   */
  const ws = useWebSocket({
    onMessage: (msg) => {
      if (msg.type === "session_title") {
        // Update baris terkait saja — state lain (urutan, summary) tidak berubah.
        setSessions((prev) =>
          prev.map((s) => (s.id === msg.sessionId ? { ...s, title: msg.title } : s)),
        );
      } else if (msg.type === "session_status") {
        // Status berubah di tempat lain (Session view, crash, perangkat lain).
        setSessions((prev) =>
          prev.map((s) =>
            s.id === msg.sessionId && s.status !== msg.status ? { ...s, status: msg.status } : s,
          ),
        );
      } else if (msg.type === "session_deleted") {
        setSessions((prev) => prev.filter((s) => s.id !== msg.sessionId));
      } else if (msg.type === "data_changed") {
        // Session baru dibuat di perangkat/tab lain -> muat ulang tanpa skeleton.
        void refresh({ silent: true });
      }
    },
  });
  useEffect(() => {
    ws.attach("");
    return () => ws.disconnect();
  }, [ws.attach, ws.disconnect]);
  const resync = useCallback(() => refresh({ silent: true }), [refresh]);
  useResyncOnReconnect(ws.status, resync);

  // Running -> crashed -> stopped, terbaru di atas (lib/session-summary.ts).
  const ordered = useMemo(() => sortSessions(sessions), [sessions]);
  const summary = useMemo(() => summarizeSessions(sessions), [sessions]);

  /** Stop ≠ hapus: POST /stop hanya mengubah status; data tetap ada dan
      bisa dihidupkan kembali lewat aksi Hidupkan (resume). */
  const stop = useCallback(
    async (sessionId: string) => {
      setStopping(sessionId);
      try {
        await apiFetch(`/api/sessions/${sessionId}/stop`, { method: "POST" });
        toast.success("Session stopped.");
        await refresh();
        notifyDataChanged();
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : "Couldn't stop the session.");
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
      try {
        await apiFetch(`/api/sessions/${sessionId}`, { method: "POST" });
        toast.success("Session resumed.");
        await refresh();
        notifyDataChanged();
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : "Couldn't resume the session.");
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
    try {
      await apiFetch(`/api/sessions/${session.id}`, { method: "DELETE" });
      setPendingDelete(null);
      toast.success("Session deleted.");
      await refresh();
      notifyDataChanged();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't delete the session.");
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
    try {
      await apiFetch(`/api/projects/${projectId}`, { method: "DELETE" });
      setProjectDeleteOpen(false);
      toast.success("Project removed.");
      notifyDataChanged();
      onDeleted?.();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't remove the project.");
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
