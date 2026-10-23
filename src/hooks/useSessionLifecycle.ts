/**
 * Aksi siklus hidup Session (stop / start / restart / hapus) — satu tempat
 * untuk panggilan API, flag sibuk, teks toast, dan `notifyDataChanged`.
 * Dipakai menu sidebar, daftar Session Project, dan header Session.
 *
 * Status baru tetap tiba via broadcast WS (`session_status`,
 * `session_deleted`, `data_changed`); hook ini tidak menyimpan Session.
 */
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { errorText } from "@/lib/api";
import { notifyDataChanged } from "@/lib/data-events";
import { deleteSession, resumeSession, stopSession } from "@/lib/session-api";

export type SessionLifecycleAction = "stop" | "start" | "restart" | "delete";

/** Id Session yang sedang diproses per jenis aksi (null = tidak sibuk). */
export type SessionLifecycleBusy = Record<SessionLifecycleAction, string | null>;

const IDLE: SessionLifecycleBusy = { stop: null, start: null, restart: null, delete: null };

const SUCCESS_TEXT: Record<SessionLifecycleAction, string> = {
  stop: "Session stopped.",
  start: "Session started.",
  restart: "Session restarted.",
  delete: "Session deleted.",
};

const ERROR_TEXT: Record<SessionLifecycleAction, string> = {
  stop: "Couldn't stop the session.",
  start: "Couldn't start the session.",
  restart: "Couldn't restart the session.",
  delete: "Couldn't delete the session.",
};

async function callApi(action: SessionLifecycleAction, id: string): Promise<void> {
  if (action === "stop") await stopSession(id);
  else if (action === "start") await resumeSession(id);
  else if (action === "delete") await deleteSession(id);
  else {
    await stopSession(id);
    await resumeSession(id);
  }
}

export interface UseSessionLifecycleOptions {
  /**
   * Dijalankan setelah API sukses & toast tampil, SEBELUM `notifyDataChanged`
   * dan sebelum flag sibuk dilepas (mis. tutup dialog, muat ulang daftar).
   * Error di sini ditampilkan sebagai toast gagal aksi tersebut.
   */
  onSuccess?: (action: SessionLifecycleAction, id: string) => void | Promise<void>;
}

export interface SessionLifecycle {
  busy: SessionLifecycleBusy;
  /** Jalankan aksi; `true` bila sukses (toast sudah tampil). */
  run: (action: SessionLifecycleAction, id: string) => Promise<boolean>;
}

export function useSessionLifecycle({
  onSuccess,
}: UseSessionLifecycleOptions = {}): SessionLifecycle {
  const [busy, setBusy] = useState<SessionLifecycleBusy>(IDLE);
  // Ref agar `run` stabil walau callback pemanggil berganti tiap render.
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  const run = useCallback(async (action: SessionLifecycleAction, id: string) => {
    setBusy((prev) => ({ ...prev, [action]: id }));
    try {
      await callApi(action, id);
      toast.success(SUCCESS_TEXT[action]);
      await onSuccessRef.current?.(action, id);
      notifyDataChanged();
      return true;
    } catch (e) {
      toast.error(errorText(e, ERROR_TEXT[action]));
      return false;
    } finally {
      setBusy((prev) => ({ ...prev, [action]: null }));
    }
  }, []);

  return { busy, run };
}
