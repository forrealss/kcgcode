/**
 * Notifikasi agent — dikirim ke Client lewat WebSocket (`notify`) dan ke
 * perangkat yang berlangganan lewat Web Push (payload JSON yang sama).
 *
 * - `permission` / `question`: agent menunggu jawaban user.
 * - `done`: turn selesai dengan sendirinya.
 * - `failed`: turn berhenti karena error / timeout / server mati.
 * - `test`: tombol "Send test notification" di Settings.
 */
export type AgentNotificationKind = "permission" | "question" | "done" | "failed" | "test";

export interface AgentNotification {
  /** Id unik per notifikasi — dipakai Client untuk `notify_ack`. */
  id: string;
  kind: AgentNotificationKind;
  /** null untuk notifikasi uji. */
  sessionId: string | null;
  title: string;
  body: string;
  /** Path halaman tujuan saat notifikasi diklik. */
  url: string;
  createdAt: number;
}
