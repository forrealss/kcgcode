/**
 * Info aplikasi dari `GET /api/meta` (versi + update tersedia) — dibagi
 * antara banner update di sidebar & Settings -> About, jadi satu permintaan
 * cukup untuk keduanya.
 *
 * Server mengecek npm berkala, jadi tab yang lama terbuka mengambil ulang
 * saat kembali terlihat bila hasil terakhir sudah basi (`STALE_MS`).
 */
import { useSyncExternalStore } from "react";
import { apiFetch } from "@/lib/api";
import type { AppInfo } from "@/server/services/app-info";

const STALE_MS = 30 * 60 * 1000;

export interface AppInfoState {
  info: AppInfo | null;
  /** Gagal dimuat dan belum ada data sebelumnya. */
  failed: boolean;
}

let state: AppInfoState = { info: null, failed: false };
let fetchedAt = 0;
let inflight = false;
const listeners = new Set<() => void>();

function refresh(): void {
  if (inflight || (state.info && Date.now() - fetchedAt < STALE_MS)) return;
  inflight = true;
  void apiFetch("/api/meta")
    .then((res) => res.json() as Promise<AppInfo>)
    .then((info) => {
      fetchedAt = Date.now();
      setState({ info, failed: false });
    })
    .catch(() => {
      if (!state.info) setState({ info: null, failed: true });
    })
    .finally(() => {
      inflight = false;
    });
}

function setState(next: AppInfoState): void {
  state = next;
  for (const fn of listeners) fn();
}

function onVisible(): void {
  if (document.visibilityState === "visible") refresh();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) document.addEventListener("visibilitychange", onVisible);
  refresh();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) document.removeEventListener("visibilitychange", onVisible);
  };
}

export function useAppInfo(): AppInfoState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}
