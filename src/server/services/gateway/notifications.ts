/**
 * Broadcast server -> Client (`notify*`): tiap fungsi memilih cakupan —
 * koneksi yang attach Session (`broadcast`), semua koneksi (`broadcastAll`),
 * atau hanya koneksi mode daftar (`broadcastListMode`).
 */
import type {
  AgentNotification,
  InteractivePrompt,
  MessagePart,
  SessionMessage,
  SessionStatus,
} from "../../../types";
import type { SubscriberRegistry } from "./subscriber-registry";
import type { WebSocketGateway } from "./types";

export type GatewayNotifications = Pick<
  WebSocketGateway,
  | "notifyMessage"
  | "notifyMessagePart"
  | "notifyMessagePartDelta"
  | "notifyPrompt"
  | "notifySessionStatus"
  | "notifySessionTitle"
  | "notifySessionPermissionMode"
  | "notifySessionCompaction"
  | "notifyTurnActive"
  | "notifySessionDeleted"
  | "notifyDataChanged"
  | "notifyPromptResolved"
  | "notifyError"
  | "notifyAgent"
>;

export function createGatewayNotifications(registry: SubscriberRegistry): GatewayNotifications {
  const { broadcast, broadcastAll, broadcastListMode } = registry;

  function notifyMessage(sessionId: string, message: SessionMessage): void {
    broadcast(sessionId, () => ({ type: "message", sessionId, message }));
  }

  function notifyMessagePart(sessionId: string, messageId: string, part: MessagePart): void {
    broadcast(sessionId, () => ({ type: "message_part", sessionId, messageId, part }));
  }

  function notifyMessagePartDelta(
    sessionId: string,
    messageId: string,
    partId: string,
    field: string,
    delta: string,
  ): void {
    broadcast(sessionId, () => ({
      type: "message_part_delta",
      sessionId,
      messageId,
      partId,
      field,
      delta,
    }));
  }

  function notifyPrompt(sessionId: string, prompt: InteractivePrompt): void {
    broadcast(sessionId, () => ({ type: "prompt", sessionId, prompt }));
  }

  function notifySessionStatus(sessionId: string, status: SessionStatus): void {
    // Relevan lintas halaman: titik status di sidebar / daftar Session harus
    // ikut berubah walau koneksi itu tidak sedang attach Session ini.
    broadcastAll(() => ({ type: "session_status", sessionId, status }));
  }

  function notifySessionTitle(sessionId: string, title: string): void {
    // `session_title` relevan bagi koneksi mana pun (daftar Session di
    // halaman Project), jadi dikirim ke semua koneksi — termasuk yang tidak
    // sedang attach satu Session.
    broadcastAll(() => ({ type: "session_title", sessionId, title }));
  }

  function notifySessionPermissionMode(sessionId: string, mode: string | null): void {
    broadcast(sessionId, () => ({ type: "session_permission_mode", sessionId, mode }));
  }

  function notifySessionCompaction(sessionId: string, compacting: boolean): void {
    broadcast(sessionId, () => ({ type: "session_compaction", sessionId, compacting }));
  }

  function notifyTurnActive(sessionId: string, active: boolean): void {
    broadcast(sessionId, () => ({ type: "turn_active", sessionId, active }));
  }

  /**
   * Session dihapus permanen — dikirim ke SEMUA koneksi: yang sedang membuka
   * Session ini meninggalkan halamannya, sidebar/daftar menghapus barisnya.
   */
  function notifySessionDeleted(sessionId: string): void {
    broadcastAll(() => ({ type: "session_deleted", sessionId }));
  }

  function notifyDataChanged(): void {
    broadcastAll(() => ({ type: "data_changed" }));
  }

  function notifyPromptResolved(sessionId: string, promptId: string): void {
    broadcast(sessionId, () => ({ type: "prompt_resolved", sessionId, promptId }));
  }

  function notifyError(sessionId: string, code: string, message: string): void {
    broadcast(sessionId, () => ({ type: "error", code, message }));
  }

  function notifyAgent(notification: AgentNotification): void {
    // Hanya koneksi mode daftar: tiap halaman punya sidebar (mode daftar),
    // jadi cukup sekali per tab tanpa ikut ke koneksi per-Session.
    broadcastListMode(() => ({ type: "notify", notification }));
  }

  return {
    notifyMessage,
    notifyMessagePart,
    notifyMessagePartDelta,
    notifyPrompt,
    notifySessionStatus,
    notifySessionTitle,
    notifySessionPermissionMode,
    notifySessionCompaction,
    notifyTurnActive,
    notifySessionDeleted,
    notifyDataChanged,
    notifyPromptResolved,
    notifyError,
    notifyAgent,
  };
}
