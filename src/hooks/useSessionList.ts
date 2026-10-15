/**
 * Engine halaman daftar Session milik satu Project (`SessionList.tsx`).
 *
 * Mengelola pemuatan daftar (`GET /api/sessions` di-filter per Project),
 * aksi per-Session (stop/start/hapus), selection mode untuk hapus massal,
 * serta dialog konfirmasi hapus Project (yang menghapus seluruh Session-nya). Sisa logika form pembuatan Session
 * baru hidup di `NewSessionDialog`.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useResyncOnReconnect } from "@/hooks/useResyncOnReconnect";
import { useWebSocket } from "@/hooks/useWebSocket";
import { apiFetch, errorText } from "@/lib/api";
import { notifyDataChanged } from "@/lib/data-events";
import { deleteSession, resumeSession, stopSession } from "@/lib/session-api";
import { pluralSessions, pruneSelection, toggleSelection } from "@/lib/session-selection";
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

  // Selection mode (hapus massal)
  selecting: boolean;
  startSelecting: () => void;
  stopSelecting: () => void;
  /** Id Session terpilih (hanya yang masih ada). */
  selected: ReadonlySet<string>;
  toggleSelect: (sessionId: string) => void;
  /** Pilih semua; bila semua sudah terpilih -> kosongkan. */
  toggleSelectAll: () => void;
  bulkDeleteOpen: boolean;
  requestBulkDelete: () => void;
  cancelBulkDelete: () => void;
  /** Progres hapus massal; null = tidak berjalan. */
  bulkProgress: { done: number; total: number } | null;
  confirmBulkRemove: () => Promise<void>;

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
  const [selecting, setSelecting] = useState(false);
  const [rawSelected, setRawSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

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
        setLoadError(errorText(e, "Failed to load sessions"));
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

  // Session yang hilang (dihapus di tab/perangkat lain) otomatis tidak
  // terpilih lagi.
  const selected = useMemo(() => pruneSelection(rawSelected, sessions), [rawSelected, sessions]);

  /** Stop ≠ hapus: POST /stop hanya mengubah status; data tetap ada dan
      bisa dihidupkan kembali lewat aksi Hidupkan (resume). */
  const stop = useCallback(
    async (sessionId: string) => {
      setStopping(sessionId);
      try {
        await stopSession(sessionId);
        toast.success("Session stopped.");
        await refresh();
        notifyDataChanged();
      } catch (e) {
        toast.error(errorText(e, "Couldn't stop the session."));
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
        await resumeSession(sessionId);
        toast.success("Session resumed.");
        await refresh();
        notifyDataChanged();
      } catch (e) {
        toast.error(errorText(e, "Couldn't resume the session."));
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
      await deleteSession(session.id);
      setPendingDelete(null);
      toast.success("Session deleted.");
      await refresh();
      notifyDataChanged();
    } catch (e) {
      toast.error(errorText(e, "Couldn't delete the session."));
    } finally {
      setDeleting(null);
    }
  }, [pendingDelete, refresh]);

  const startSelecting = useCallback(() => {
    setRawSelected(new Set());
    setSelecting(true);
  }, []);
  const stopSelecting = useCallback(() => {
    setSelecting(false);
    setRawSelected(new Set());
  }, []);
  const toggleSelect = useCallback(
    (sessionId: string) => setRawSelected((prev) => toggleSelection(prev, sessionId)),
    [],
  );
  const toggleSelectAll = useCallback(() => {
    setRawSelected((prev) =>
      sessions.length > 0 && sessions.every((s) => prev.has(s.id))
        ? new Set()
        : new Set(sessions.map((s) => s.id)),
    );
  }, [sessions]);
  const requestBulkDelete = useCallback(() => setBulkDeleteOpen(true), []);
  const cancelBulkDelete = useCallback(() => setBulkDeleteOpen(false), []);

  /**
   * Hapus massal Session terpilih — satu per satu (berurutan, agar server
   * headless tidak dibanjiri), progres tampil di dialog konfirmasi. Yang
   * gagal tetap terpilih supaya bisa dicoba lagi.
   */
  const confirmBulkRemove = useCallback(async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    const failed: string[] = [];
    setBulkProgress({ done: 0, total: ids.length });
    for (const [i, id] of ids.entries()) {
      setDeleting(id);
      try {
        await deleteSession(id);
      } catch {
        failed.push(id);
      }
      setBulkProgress({ done: i + 1, total: ids.length });
    }
    setDeleting(null);
    setBulkProgress(null);
    setBulkDeleteOpen(false);
    const removed = ids.length - failed.length;
    if (failed.length === 0) {
      toast.success(`Deleted ${pluralSessions(removed)}.`);
      setSelecting(false);
      setRawSelected(new Set());
    } else {
      toast.error(`Couldn't delete ${failed.length} of ${pluralSessions(ids.length)}.`);
      setRawSelected(new Set(failed));
    }
    await refresh({ silent: true });
    notifyDataChanged();
  }, [selected, refresh]);

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
      toast.error(errorText(e, "Couldn't remove the project."));
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
    selecting,
    startSelecting,
    stopSelecting,
    selected,
    toggleSelect,
    toggleSelectAll,
    bulkDeleteOpen,
    requestBulkDelete,
    cancelBulkDelete,
    bulkProgress,
    confirmBulkRemove,
    projectDeleteOpen,
    openProjectDelete,
    closeProjectDelete,
    deletingProject,
    confirmRemoveProject,
  };
}
