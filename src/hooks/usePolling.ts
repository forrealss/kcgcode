/**
 * Jalankan `fn` segera lalu tiap `ms` selama `enabled`. Mulai ulang (panggil
 * segera + interval baru) bila `fn`, `ms`, atau `enabled` berganti — jadi
 * pemanggil membungkus `fn` dengan `useCallback`.
 *
 * `pauseWhenHidden`: tab di latar belakang -> interval dihentikan; kembali
 * terlihat -> `fn` dipanggil segera dan interval dilanjutkan.
 */
import { useEffect } from "react";

export interface UsePollingOptions {
  enabled?: boolean;
  pauseWhenHidden?: boolean;
}

export function usePolling(
  fn: () => unknown,
  ms: number,
  { enabled = true, pauseWhenHidden = false }: UsePollingOptions = {},
): void {
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer === null) timer = setInterval(() => void fn(), ms);
    };
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    void fn();
    if (!pauseWhenHidden || typeof document === "undefined") {
      start();
      return stop;
    }
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void fn();
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fn, ms, enabled, pauseWhenHidden]);
}
