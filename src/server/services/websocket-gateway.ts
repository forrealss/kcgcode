/**
 * WebSocket_Gateway — registrasi koneksi, reattach, broadcast (versi headless).
 *
 * Perubahan dari versi PTY/TUI:
 * - Cursor `seq` per-koneksi dihapus (tidak ada lagi chunk Output_Stream);
 *   reattach mengirim `history` berisi `messages` + `prompts` pending.
 * - `input` / `prompt_response` kini asinkron (HTTP ke server headless);
 *   error asinkron dilaporkan via pesan `error` ke Client pengirim.
 * - Pesan `stop` meneruskan ke `stopSession`; pesan `interrupt` meneruskan
 *   ke `interruptSession` (hentikan balasan saja, Session tetap berjalan).
 *
 * Prinsip yang dipertahankan: kegagalan `send` ke satu Client ditangkap
 * per-Client (hapus subscriber) tanpa menghentikan broadcast ke Client lain
 * (Requirement 5.3); attach ke Session tidak ditemukan -> `error` + `close`
 * (Requirement 4.3).
 *
 * File ini hanya komposisi; implementasinya ada di `./gateway/`: kontrak
 * publik (`types`), pemetaan error ke protokol (`error-mapping`), registri
 * subscriber + primitif broadcast (`subscriber-registry`), handler pesan
 * Client (`client-actions`), dan broadcast `notify*` (`notifications`).
 */
import { createClientActions } from "./gateway/client-actions";
import { createGatewayNotifications } from "./gateway/notifications";
import { createSubscriberRegistry } from "./gateway/subscriber-registry";
import type { WebSocketGateway, WebSocketGatewayOptions } from "./gateway/types";

export type {
  AttachedInfo,
  Subscriber,
  WebSocketGateway,
  WebSocketGatewayOptions,
} from "./gateway/types";

export function createWebSocketGateway(opts: WebSocketGatewayOptions): WebSocketGateway {
  const { store, sessionManager } = opts;
  const registry = createSubscriberRegistry();
  const notifications = createGatewayNotifications(registry);
  const actions = createClientActions({
    store,
    sessionManager,
    registry,
    notifyPromptResolved: notifications.notifyPromptResolved,
  });

  function notifyAck(id: string, endpoint: string): void {
    opts.onNotifyAck?.(id, endpoint);
  }

  return {
    attach: actions.attach,
    input: actions.input,
    promptResponse: actions.promptResponse,
    stop: actions.stop,
    interrupt: actions.interrupt,
    notifyMessage: notifications.notifyMessage,
    notifyMessagePart: notifications.notifyMessagePart,
    notifyMessagePartDelta: notifications.notifyMessagePartDelta,
    notifyPrompt: notifications.notifyPrompt,
    notifySessionStatus: notifications.notifySessionStatus,
    notifySessionTitle: notifications.notifySessionTitle,
    notifySessionPermissionMode: notifications.notifySessionPermissionMode,
    notifySessionCompaction: notifications.notifySessionCompaction,
    notifyTurnActive: notifications.notifyTurnActive,
    notifySessionDeleted: notifications.notifySessionDeleted,
    notifyDataChanged: notifications.notifyDataChanged,
    notifyPromptResolved: notifications.notifyPromptResolved,
    notifyError: notifications.notifyError,
    notifyAgent: notifications.notifyAgent,
    notifyAck,
    detach: registry.detach,
    subscriberCount: registry.subscriberCount,
  };
}
