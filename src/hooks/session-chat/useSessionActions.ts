/**
 * Aksi Session via REST API (resume, stop, hapus) beserta state loading &
 * dialog konfirmasi hapus. Bagian dari `useSessionChat`; error banner global
 * tetap milik hook induk (di-reset lewat `setError` sebelum tiap aksi).
 */
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { errorText } from "@/lib/api";
import { notifyDataChanged } from "@/lib/data-events";
import { deleteSession, resumeSession, stopSession } from "@/lib/session-api";
import type { SessionChat } from "./types";

interface UseSessionActionsOptions {
  sessionId: string;
  onBack: () => void;
  /** Dipanggil setelah Session dihapus dari menu aksi header. */
  onDeleted?: () => void;
  /** Setter error banner global milik `useSessionChat` (stabil). */
  setError: (message: string | null) => void;
}

export type SessionActions = Pick<
  SessionChat,
  | "starting"
  | "start"
  | "stopping"
  | "stop"
  | "deleteOpen"
  | "beginDelete"
  | "cancelDelete"
  | "deleting"
  | "confirmDelete"
>;

export function useSessionActions({
  sessionId,
  onBack,
  onDeleted,
  setError,
}: UseSessionActionsOptions): SessionActions {
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  /** Resume via API langsung — hasil status baru tiba via WS `session_status`. */
  const start = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      await resumeSession(sessionId);
      // Status baru dikirim gateway ke semua subscriber; tak perlu setState di sini.
      toast.success("Session resumed.");
    } catch (e) {
      toast.error(errorText(e, "Couldn't resume the session."));
    } finally {
      setStarting(false);
    }
  }, [sessionId, setError]);

  /**
   * Hentikan Session (bukan hanya balasan model): status -> `stopped`.
   * Berbeda dari tombol Stop di composer yang hanya meng-interrupt turn.
   */
  const stop = useCallback(async () => {
    setStopping(true);
    setError(null);
    try {
      await stopSession(sessionId);
      toast.success("Session stopped.");
    } catch (e) {
      toast.error(errorText(e, "Couldn't stop the session."));
    } finally {
      setStopping(false);
    }
  }, [sessionId, setError]);

  /** Hapus Session permanen dari menu aksi header (dikonfirmasi lebih dulu). */
  const beginDelete = useCallback(() => setDeleteOpen(true), []);
  const cancelDelete = useCallback(() => setDeleteOpen(false), []);
  const confirmDelete = useCallback(async () => {
    setDeleting(true);
    setError(null);
    try {
      await deleteSession(sessionId);
      setDeleteOpen(false);
      toast.success("Session deleted.");
      notifyDataChanged();
      (onDeleted ?? onBack)();
    } catch (e) {
      toast.error(errorText(e, "Couldn't delete the session."));
    } finally {
      setDeleting(false);
    }
  }, [sessionId, onBack, onDeleted, setError]);

  return {
    starting,
    start,
    stopping,
    stop,
    deleteOpen,
    beginDelete,
    cancelDelete,
    deleting,
    confirmDelete,
  };
}
