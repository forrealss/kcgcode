/**
 * Sinyal Preview dari WS ke komponen yang memuat datanya sendiri:
 * `preview_status` (koneksi mode daftar milik sidebar, ada di setiap halaman)
 * ke sheet Preview, dan `preview_snapshot` (koneksi Session) ke kartu snapshot.
 */
import type { DevServerStatus, PreviewSnapshot } from "@/types";

const PREVIEW_STATUS_EVENT = "kcg-preview-status";

export interface PreviewStatusDetail {
  projectId: string;
  server: DevServerStatus | null;
}

export function emitPreviewStatus(detail: PreviewStatusDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<PreviewStatusDetail>(PREVIEW_STATUS_EVENT, { detail }));
}

/** Berlangganan; mengembalikan fungsi berhenti berlangganan. */
export function onPreviewStatus(listener: (detail: PreviewStatusDetail) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => listener((e as CustomEvent<PreviewStatusDetail>).detail);
  window.addEventListener(PREVIEW_STATUS_EVENT, handler);
  return () => window.removeEventListener(PREVIEW_STATUS_EVENT, handler);
}

const PREVIEW_SNAPSHOT_EVENT = "kcg-preview-snapshot";

export interface PreviewSnapshotDetail {
  sessionId: string;
  snapshot: PreviewSnapshot;
}

export function emitPreviewSnapshot(detail: PreviewSnapshotDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<PreviewSnapshotDetail>(PREVIEW_SNAPSHOT_EVENT, { detail }));
}

export function onPreviewSnapshot(listener: (detail: PreviewSnapshotDetail) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => listener((e as CustomEvent<PreviewSnapshotDetail>).detail);
  window.addEventListener(PREVIEW_SNAPSHOT_EVENT, handler);
  return () => window.removeEventListener(PREVIEW_SNAPSHOT_EVENT, handler);
}
