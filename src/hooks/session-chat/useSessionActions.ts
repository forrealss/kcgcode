/**
 * Aksi Session via REST API (resume, stop, hapus) beserta state loading &
 * dialog konfirmasi hapus. Bagian dari `useSessionChat`; error banner global
 * tetap milik hook induk (di-reset lewat `setError` sebelum tiap aksi).
 */
import { useCallback, useState } from "react";
import { useSessionLifecycle } from "@/hooks/useSessionLifecycle";
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
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { busy, run } = useSessionLifecycle({
    onSuccess: (action) => {
      if (action === "delete") setDeleteOpen(false);
    },
  });
  const starting = busy.start !== null;
  const stopping = busy.stop !== null;
  const deleting = busy.delete !== null;

  /** Resume via API langsung — hasil status baru tiba via WS `session_status`. */
  const start = useCallback(async () => {
    setError(null);
    await run("start", sessionId);
  }, [sessionId, setError, run]);

  /**
   * Hentikan Session (bukan hanya balasan model): status -> `stopped`.
   * Berbeda dari tombol Stop di composer yang hanya meng-interrupt turn.
   */
  const stop = useCallback(async () => {
    setError(null);
    await run("stop", sessionId);
  }, [sessionId, setError, run]);

  /** Hapus Session permanen dari menu aksi header (dikonfirmasi lebih dulu). */
  const beginDelete = useCallback(() => setDeleteOpen(true), []);
  const cancelDelete = useCallback(() => setDeleteOpen(false), []);
  const confirmDelete = useCallback(async () => {
    setError(null);
    if (await run("delete", sessionId)) (onDeleted ?? onBack)();
  }, [sessionId, onBack, onDeleted, setError, run]);

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
