/**
 * Update KCG Code dari app: panggilan `/api/update*` + "permintaan update"
 * dari banner sidebar / dialog versi baru yang dijemput halaman About.
 *
 * Banner & dialog hanya menavigasi ke Settings -> About; panel update di
 * sana yang memulai instalasi (dan menampilkan konfirmasi bila ada Session
 * yang masih berjalan), jadi alur & peringatannya ada di satu tempat.
 */
import { apiFetch } from "@/lib/api";
import type { SelfUpdateStatus, SelfUpdateStep } from "@/types";

export const UPDATE_LOGS_PATH = "/api/update/logs";

export async function getUpdateStatus(): Promise<SelfUpdateStatus> {
  return (await apiFetch("/api/update")).json() as Promise<SelfUpdateStatus>;
}

export async function startUpdate(version: string): Promise<SelfUpdateStatus> {
  const res = await apiFetch("/api/update", {
    method: "POST",
    body: JSON.stringify({ version }),
  });
  return res.json() as Promise<SelfUpdateStatus>;
}

/** Versi yang sedang berjalan (`/api/meta`); null saat server belum bisa dijangkau. */
export async function fetchRunningVersion(): Promise<string | null> {
  try {
    const res = await apiFetch("/api/meta");
    return ((await res.json()) as { version?: string }).version ?? null;
  } catch {
    return null;
  }
}

/** Fase dengan job berjalan (status di-poll). */
export function isUpdateActive(status: SelfUpdateStatus | null): boolean {
  return status?.phase === "installing" || status?.phase === "verifying";
}

export function updateStepLabel(step: SelfUpdateStep | null, version: string): string {
  switch (step) {
    case "downloading":
      return `Downloading v${version}…`;
    case "linking":
      return "Installing…";
    case "verifying":
      return "Checking the installation…";
    default:
      return "Preparing…";
  }
}

// ---- Permintaan "update sekarang" dari banner / dialog ----

let requested = false;
const listeners = new Set<() => void>();

/** Banner / dialog: minta panel About memulai update setibanya di sana. */
export function requestUpdateStart(): void {
  requested = true;
  for (const fn of listeners) fn();
}

/** Ambil (sekali) permintaan yang tertunda. */
export function consumeUpdateRequest(): boolean {
  const was = requested;
  requested = false;
  return was;
}

/** Panggil `fn` tiap ada permintaan baru (panel About sudah terbuka). */
export function onUpdateRequest(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
