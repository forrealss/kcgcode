/**
 * Sinyal perubahan file: WS `turn_diff` (koneksi Session) ke kartu perubahan
 * di timeline, dan permintaan membuka viewer file dari bagian UI mana pun
 * (mis. daftar Reference) ke host viewer di halaman Session.
 */
import type { TurnDiff } from "@/types";

const TURN_DIFF_EVENT = "kcg-turn-diff";
const OPEN_FILE_EVENT = "kcg-open-file";

export function emitTurnDiff(diff: TurnDiff): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<TurnDiff>(TURN_DIFF_EVENT, { detail: diff }));
}

export function onTurnDiff(listener: (diff: TurnDiff) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => listener((e as CustomEvent<TurnDiff>).detail);
  window.addEventListener(TURN_DIFF_EVENT, handler);
  return () => window.removeEventListener(TURN_DIFF_EVENT, handler);
}

/** Buka viewer untuk file Project `path` (relatif folder Project). */
export function openFileViewer(path: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<string>(OPEN_FILE_EVENT, { detail: path }));
}

export function onOpenFileViewer(listener: (path: string) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => listener((e as CustomEvent<string>).detail);
  window.addEventListener(OPEN_FILE_EVENT, handler);
  return () => window.removeEventListener(OPEN_FILE_EVENT, handler);
}
