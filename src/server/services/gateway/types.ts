/**
 * Kontrak publik WebSocket_Gateway: abstraksi koneksi (`Subscriber`),
 * info attach per koneksi, opsi pembuatan, dan antarmuka `WebSocketGateway`.
 */
import type { SessionStore } from "../../../db";
import type {
  AgentNotification,
  ComposerDraft,
  DevServerStatus,
  InteractivePrompt,
  MessagePart,
  PreviewSnapshot,
  PromptResponse,
  SessionMessage,
  SessionStatus,
  TurnDiff,
} from "../../../types";
import type { ServerMessage } from "../../../ws-protocol";
import type { SessionManager } from "../session-manager";

/** Abstraksi koneksi — diimplementasikan oleh `bunWsSubscriber` atau mock test. */
export interface Subscriber {
  send(msg: ServerMessage): void;
  close(): void;
}

/**
 * Koneksi yang ter-attach ke sebuah Session.
 * `sessionId: null` = mode daftar (tanpa Session) — hanya menerima broadcast
 * global seperti `session_title` (daftar Session di halaman Project).
 */
export interface AttachedInfo {
  sessionId: string | null;
}

export interface WebSocketGatewayOptions {
  store: SessionStore;
  sessionManager: SessionManager;
  /** Client melaporkan notifikasi sudah tampil di layarnya (`notify_ack`). */
  onNotifyAck?: (id: string, endpoint: string) => void;
}

export interface WebSocketGateway {
  attach(sub: Subscriber, sessionId: string): void;
  input(
    sub: Subscriber,
    sessionId: string,
    text: string,
    files?: string[],
    images?: string[],
  ): void;
  promptResponse(
    sub: Subscriber,
    sessionId: string,
    promptId: string,
    response: PromptResponse,
  ): void;
  stop(sub: Subscriber, sessionId: string): void;
  /** Hentikan balasan model saja (interrupt) — Session tetap running. */
  interrupt(sub: Subscriber, sessionId: string): void;
  notifyMessage(sessionId: string, message: SessionMessage): void;
  notifyMessagePart(sessionId: string, messageId: string, part: MessagePart): void;
  notifyMessagePartDelta(
    sessionId: string,
    messageId: string,
    partId: string,
    field: string,
    delta: string,
  ): void;
  notifyPrompt(sessionId: string, prompt: InteractivePrompt): void;
  notifySessionStatus(sessionId: string, status: SessionStatus): void;
  /** Broadcast judul Session baru hasil generate opencode. */
  notifySessionTitle(sessionId: string, title: string): void;
  /** Permission mode Session berubah — dikirim ke koneksi yang attach Session. */
  notifySessionPermissionMode(sessionId: string, mode: string | null): void;
  notifySessionCompaction(sessionId: string, compacting: boolean): void;
  /** Beri tahu subscriber apakah model sedang merespon (turn aktif). */
  notifyTurnActive(sessionId: string, active: boolean): void;
  notifySessionDeleted(sessionId: string): void;
  /** Daftar Project/Session berubah — broadcast ke semua koneksi. */
  notifyDataChanged(): void;
  notifyPromptResolved(sessionId: string, promptId: string): void;
  notifyError(sessionId: string, code: string, message: string): void;
  /** Notifikasi agent ke koneksi mode daftar (sidebar ada di tiap halaman). */
  notifyAgent(notification: AgentNotification): void;
  /** Status dev server Preview berubah — ke koneksi mode daftar. */
  notifyPreviewStatus(projectId: string, server: DevServerStatus | null): void;
  /** Snapshot preview setelah turn — ke koneksi yang attach Session. */
  notifyPreviewSnapshot(sessionId: string, snapshot: PreviewSnapshot): void;
  /** File berubah di turn yang baru selesai — ke koneksi yang attach Session. */
  notifyTurnDiff(sessionId: string, diff: TurnDiff): void;
  /** Teruskan `notify_ack` dari Client ke layanan notifikasi. */
  notifyAck(id: string, endpoint: string): void;
  /** Pesan `draft` dari Client (WebSocket). */
  draft(sub: Subscriber, sessionId: string, draft: ComposerDraft, origin: string): void;
  /** Draf composer Session saat ini (kosong bila tidak ada). */
  getDraft(sessionId: string): ComposerDraft;
  /** Simpan draf & siarkan ke koneksi Session (juga dipakai overlay Preview). */
  setDraft(sessionId: string, draft: ComposerDraft, origin: string): void;
  detach(sub: Subscriber): void;
  subscriberCount(sessionId: string): number;
}
