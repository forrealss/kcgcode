/**
 * Snapshot preview otomatis: setelah turn agent selesai di Session yang dev
 * server Project-nya hidup, halaman terakhir yang dilihat di preview
 * di-capture (viewport perangkat terakhir) dan dikirim ke chat. Hasilnya
 * terlihat tanpa membuka preview — dan tetap berguna lewat localhost.run,
 * yang tidak bisa membuka preview langsung.
 *
 * Hanya snapshot terbaru per Session yang disimpan (lampiran lama dihapus)
 * agar folder lampiran tidak membengkak tiap turn. Matikan dengan env
 * `KCG_PREVIEW_SNAPSHOTS=0`.
 */

import type { PreviewSnapshot } from "../../../types";
import type { Result } from "../../result";
import type { TurnOutcome } from "../turn-stream";
import type { DevServerManager } from "./dev-servers";
import type { PreviewView } from "./preview-server";
import type { Screenshotter } from "./screenshot";

export interface PreviewSnapshotsDeps {
  devServers: DevServerManager;
  screenshotter: Screenshotter;
  /** Project pemilik Session, atau null. */
  projectOf: (sessionId: string) => string | null;
  lastView: (projectId: string) => PreviewView;
  save: (sessionId: string, bytes: Uint8Array) => Result<{ id: string }>;
  remove: (sessionId: string, attachmentId: string) => void;
  notify: (sessionId: string, snapshot: PreviewSnapshot) => void;
  enabled?: boolean;
  /** Jeda setelah turn agar HMR/rebuild selesai (ms). */
  delayMs?: number;
  now?: () => number;
}

export interface PreviewSnapshots {
  onTurnEnd(sessionId: string, outcome: TurnOutcome): Promise<void>;
  latest(sessionId: string): PreviewSnapshot | null;
}

export function snapshotsEnabled(env = process.env): boolean {
  return env.KCG_PREVIEW_SNAPSHOTS !== "0";
}

export function createPreviewSnapshots(deps: PreviewSnapshotsDeps): PreviewSnapshots {
  const now = deps.now ?? Date.now;
  const enabled = deps.enabled ?? snapshotsEnabled();
  const latest = new Map<string, PreviewSnapshot>();
  const inflight = new Set<string>();

  return {
    async onTurnEnd(sessionId, outcome) {
      if (!enabled || outcome !== "done" || inflight.has(sessionId)) return;
      if (!deps.screenshotter.available()) return;
      const projectId = deps.projectOf(sessionId);
      if (!projectId || !deps.devServers.upstream(projectId)) return;
      inflight.add(sessionId);
      try {
        await Bun.sleep(deps.delayMs ?? 1500);
        const up = deps.devServers.upstream(projectId);
        if (!up) return;
        const view = deps.lastView(projectId);
        const host = up.host.includes(":") ? `[${up.host}]` : up.host;
        const shot = await deps.screenshotter.capture(
          `http://${host}:${up.port}${view.path}`,
          view.viewport ?? undefined,
        );
        if (!shot.ok) return;
        const saved = deps.save(sessionId, shot.data);
        if (!saved.ok) return;
        const prev = latest.get(sessionId);
        const snapshot: PreviewSnapshot = {
          attachmentId: saved.data.id,
          path: view.path,
          takenAt: now(),
        };
        latest.set(sessionId, snapshot);
        if (prev) deps.remove(sessionId, prev.attachmentId);
        deps.notify(sessionId, snapshot);
      } finally {
        inflight.delete(sessionId);
      }
    },
    latest: (sessionId) => latest.get(sessionId) ?? null,
  };
}
