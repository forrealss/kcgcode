/**
 * State panel update di Settings -> About: status job dari `/api/update`
 * (di-poll selama instalasi), log installer, lalu — setelah server mulai
 * restart — menunggu server kembali dengan versi baru dan me-reload halaman
 * agar bundle web terbaru yang dipakai.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useIncrementalLog } from "@/hooks/useIncrementalLog";
import { usePolling } from "@/hooks/usePolling";
import { errorText } from "@/lib/api";
import {
  fetchRunningVersion,
  getUpdateStatus,
  isUpdateActive,
  startUpdate,
  UPDATE_LOGS_PATH,
} from "@/lib/self-update";
import type { UpdateInfo } from "@/server/services/update-check";
import type { SelfUpdateStatus } from "@/types";

const STATUS_POLL_MS = 1000;
const RESTART_POLL_MS = 1500;
/** Setelah ini tampilkan petunjuk "lebih lama dari biasanya". */
export const RESTART_SLOW_MS = 60_000;

export interface SelfUpdateController {
  /** null = belum dimuat. */
  status: SelfUpdateStatus | null;
  logs: string[];
  /** POST sedang dikirim. */
  starting: boolean;
  /** Menunggu server kembali setelah restart; `slow` = sudah lama. null = tidak menunggu. */
  waiting: { slow: boolean } | null;
  start(): Promise<void>;
}

export function useSelfUpdate(update: UpdateInfo): SelfUpdateController {
  const [status, setStatus] = useState<SelfUpdateStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [job, setJob] = useState(0);
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const [slow, setSlow] = useState(false);
  const statusRef = useRef(status);
  statusRef.current = status;

  const refresh = useCallback(async () => {
    try {
      setStatus(await getUpdateStatus());
    } catch {
      // Server berhenti di tengah instalasi / saat restart -> tunggu kembali.
      const prev = statusRef.current;
      if (isUpdateActive(prev) || prev?.phase === "restarting") {
        setWaitingSince((t) => t ?? Date.now());
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const active = isUpdateActive(status);
  usePolling(refresh, STATUS_POLL_MS, { enabled: active && waitingSince === null });

  useEffect(() => {
    if (status?.phase === "restarting") setWaitingSince((t) => t ?? Date.now());
  }, [status?.phase]);

  const target = status?.target ?? update.latest;
  const checkRestarted = useCallback(async () => {
    if (waitingSince !== null && Date.now() - waitingSince > RESTART_SLOW_MS) setSlow(true);
    if ((await fetchRunningVersion()) === target) window.location.reload();
  }, [target, waitingSince]);
  usePolling(checkRestarted, RESTART_POLL_MS, { enabled: waitingSince !== null });

  const logs = useIncrementalLog(UPDATE_LOGS_PATH, {
    enabled: status !== null && status.phase !== "idle" && waitingSince === null,
    offset: status?.logOffset ?? 0,
    resetKey: job,
  });

  const start = useCallback(async () => {
    setStarting(true);
    try {
      const next = await startUpdate(update.latest);
      setJob((j) => j + 1);
      setStatus(next);
    } catch (e) {
      toast.error(errorText(e, "Couldn't start the update."));
    } finally {
      setStarting(false);
    }
  }, [update.latest]);

  return {
    status,
    logs,
    starting,
    waiting: waitingSince === null ? null : { slow },
    start,
  };
}
