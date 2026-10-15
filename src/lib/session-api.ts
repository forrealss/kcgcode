/**
 * Panggilan REST Session dari frontend — satu tempat untuk path & method
 * endpoint `/api/sessions/:id` yang dipakai menu sidebar, daftar Session
 * Project, header Session, dan pemilih model/agent/permission mode.
 *
 * Error tetap `ApiError` dari `apiFetch` (pemanggil memilih pesan fallback
 * via `errorText`). Status baru tiba lewat broadcast WS (`session_status`,
 * `session_deleted`, `data_changed`), jadi fungsi ini tidak mengembalikan
 * Session.
 */
import { apiFetch } from "@/lib/api";
import type { SessionModel } from "@/types";

/** Pengaturan Session yang bisa diubah saat berjalan (`PUT /api/sessions/:id`). */
export interface SessionSettingsPatch {
  model?: SessionModel | null;
  effort?: string | null;
  agent?: string | null;
  permissionMode?: string | null;
}

/** Hidupkan kembali Session stopped/crashed. */
export async function resumeSession(id: string): Promise<void> {
  await apiFetch(`/api/sessions/${id}`, { method: "POST" });
}

/**
 * Hentikan Session (bukan hanya balasan model): status -> `stopped`; data
 * tetap ada dan bisa di-resume. Berbeda dari Stop di composer (interrupt).
 */
export async function stopSession(id: string): Promise<void> {
  await apiFetch(`/api/sessions/${id}/stop`, { method: "POST" });
}

/** Hapus Session permanen — termasuk riwayatnya di server headless agent. */
export async function deleteSession(id: string): Promise<void> {
  await apiFetch(`/api/sessions/${id}`, { method: "DELETE" });
}

/** Ubah model / effort / agent / permission mode Session. */
export async function updateSessionSettings(
  id: string,
  patch: SessionSettingsPatch,
): Promise<void> {
  await apiFetch(`/api/sessions/${id}`, { method: "PUT", body: JSON.stringify(patch) });
}
