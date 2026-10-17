/**
 * Panggilan REST Preview (dev server Project yang dipegang kcgcode):
 * `/api/projects/:id/preview*`. Error tetap `ApiError` dari `apiFetch`.
 */
import { apiFetch } from "@/lib/api";
import type { DevServerPhase, DevServerStatus, PreviewSnapshot } from "@/types";

export type { DevServerPhase, DevServerStatus };

export interface PreviewConfig {
  source: "launch.json" | "package.json";
  name: string;
  command: string;
  port: number | null;
}

export interface PreviewInfo {
  config: PreviewConfig | null;
  server: DevServerStatus | null;
}

const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/preview`;

export async function getPreview(projectId: string): Promise<PreviewInfo> {
  return (await apiFetch(base(projectId))).json() as Promise<PreviewInfo>;
}

export async function startPreview(projectId: string): Promise<DevServerStatus> {
  const res = await apiFetch(`${base(projectId)}/start`, { method: "POST" });
  return ((await res.json()) as { server: DevServerStatus }).server;
}

export async function stopPreview(projectId: string): Promise<void> {
  await apiFetch(`${base(projectId)}/stop`, { method: "POST" });
}

export async function getPreviewLogs(
  projectId: string,
  from: number,
): Promise<{ lines: string[]; next: number }> {
  const res = await apiFetch(`${base(projectId)}/logs?from=${from}`);
  return res.json() as Promise<{ lines: string[]; next: number }>;
}

/**
 * URL sekali pakai (±60 detik) ke origin preview. `sessionId` = chat yang
 * dihubungkan ke overlay (kirim pesan & status agent dari halaman preview).
 */
export async function openPreviewUrl(projectId: string, sessionId: string | null): Promise<string> {
  const res = await apiFetch(`${base(projectId)}/open`, {
    method: "POST",
    body: JSON.stringify({ sessionId }),
  });
  return ((await res.json()) as { url: string }).url;
}

/** Dev server sedang hidup (start atau siap). */
export function isActive(phase: DevServerPhase | undefined): boolean {
  return phase === "starting" || phase === "running";
}

/** JPEG halaman dev server saat ini (Chrome headless di mesin kcgcode). */
export async function takePreviewSnapshot(projectId: string): Promise<Blob> {
  const res = await apiFetch(`${base(projectId)}/snapshot`, { method: "POST" });
  return res.blob();
}

/** Snapshot otomatis terakhir Session (setelah turn agent selesai). */
export async function getPreviewSnapshot(sessionId: string): Promise<PreviewSnapshot | null> {
  const res = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/preview-snapshot`);
  return ((await res.json()) as { snapshot: PreviewSnapshot | null }).snapshot;
}
