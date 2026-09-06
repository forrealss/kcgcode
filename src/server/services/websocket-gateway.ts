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
 */
import type { SessionStore } from "../../db";
import type {
  InteractivePrompt,
  MessagePart,
  PromptResponse,
  SessionMessage,
  SessionStatus,
} from "../../types";
import { ErrorCodes, type ServerMessage } from "../../ws-protocol";
import type { SessionManager } from "./session-manager";

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
  notifyPrompt(sessionId: string, prompt: InteractivePrompt): void;
  notifySessionStatus(sessionId: string, status: SessionStatus): void;
  /** Broadcast judul Session baru hasil generate opencode. */
  notifySessionTitle(sessionId: string, title: string): void;
  /** Beri tahu subscriber apakah model sedang merespon (turn aktif). */
  notifyTurnActive(sessionId: string, active: boolean): void;
  notifySessionDeleted(sessionId: string): void;
  notifyPromptResolved(sessionId: string, promptId: string): void;
  notifyError(sessionId: string, code: string, message: string): void;
  detach(sub: Subscriber): void;
  subscriberCount(sessionId: string): number;
}

/** Pemetaan error domain Session_Manager ke kode protokol `error`. */
function toErrorCode(error: string): string {
  if (error === ErrorCodes.SESSION_NOT_FOUND) return ErrorCodes.SESSION_NOT_FOUND;
  if (error === "SESSION_NOT_RUNNING" || error === "SESSION_NOT_ACTIVE") {
    return ErrorCodes.SESSION_NOT_RUNNING;
  }
  if (error === "TEXT_EMPTY" || error === "TEXT_TOO_LONG") return ErrorCodes.INVALID_TEXT;
  if (error === "ATTACHMENT_NOT_FOUND") return ErrorCodes.ATTACHMENT_NOT_FOUND;
  if (error === ErrorCodes.PROMPT_NOT_FOUND) return ErrorCodes.PROMPT_NOT_FOUND;
  if (error === ErrorCodes.PROMPT_ALREADY_RESOLVED) return ErrorCodes.PROMPT_ALREADY_RESOLVED;
  if (error === "INVALID_PROMPT_OPTION" || error === "INVALID_PROMPT_RESPONSE") {
    return ErrorCodes.INVALID_RESPONSE;
  }
  return "ERROR";
}

/**
 * Pesan ramah untuk kegagalan reply prompt (kartu tetap bisa dicoba lagi):
 * error mentah dari opencode-client berupa kode seperti
 * `OC_QUESTION_REPLY_FAILED(400)` — kurang berguna bagi user.
 */
function friendlyPromptError(raw: string): string {
  if (
    raw === ErrorCodes.PROMPT_NOT_FOUND ||
    raw.startsWith("OC_QUESTION") ||
    raw.startsWith("OC_PERMISSION")
  ) {
    return "The agent is no longer waiting for this answer (it may have moved on). Try again or send a new message.";
  }
  if (raw === "SESSION_NOT_ACTIVE" || raw === "SESSION_NOT_RUNNING") {
    return "The session is not running. Start it again to answer.";
  }
  if (raw === ErrorCodes.PROMPT_ALREADY_RESOLVED) {
    return "This prompt was already answered.";
  }
  return `Failed to send the answer (${raw.split("(")[0] ?? raw}). Try again.`;
}

export function createWebSocketGateway(opts: WebSocketGatewayOptions): WebSocketGateway {
  const { store, sessionManager } = opts;
  const subs = new Map<Subscriber, AttachedInfo>();

  /** Kirim pesan; bila `send` melempar, hapus subscriber (Req 5.3). */
  function sendSafe(sub: Subscriber, msg: ServerMessage): boolean {
    try {
      sub.send(msg);
      return true;
    } catch {
      subs.delete(sub);
      return false;
    }
  }

  function attach(sub: Subscriber, sessionId: string): void {
    // Mode daftar (sessionId kosong): tanpa `history`, cukup daftar sebagai
    // penerima broadcast global (`session_title`).
    if (sessionId === "") {
      subs.set(sub, { sessionId: null });
      return;
    }
    // (1) validasi Session ada di store (Req 4.3)
    const sess = store.getSession(sessionId);
    if (!sess.ok) {
      sendSafe(sub, {
        type: "error",
        code: ErrorCodes.SESSION_NOT_FOUND,
        message: "Session not found.",
      });
      sub.close();
      return;
    }

    // (2) riwayat pesan terstruktur + prompt pending (Req 4.1, 4.4)
    const messages = store.getMessages(sessionId);
    if (!messages.ok) {
      sendSafe(sub, { type: "error", code: "STORE_ERROR", message: messages.error });
      sub.close();
      return;
    }
    const prompts = store.listPendingPrompts(sessionId);
    if (!sendSafe(sub, { type: "history", sessionId, messages: messages.data, prompts })) return;

    // (3) daftarkan sebagai subscriber live
    subs.set(sub, { sessionId });
  }

  function input(
    sub: Subscriber,
    sessionId: string,
    text: string,
    files?: string[],
    images?: string[],
  ): void {
    void sessionManager
      .sendFreeTextInput(sessionId, text, files ?? [], images ?? [])
      .then((res) => {
        if (!res.ok) {
          const code = toErrorCode(res.error ?? "");
          sendSafe(sub, { type: "error", code, message: res.error ?? "ERROR" });
        }
      })
      .catch(() => {
        sendSafe(sub, { type: "error", code: "ERROR", message: "Failed to send the message." });
      });
  }

  function promptResponse(
    sub: Subscriber,
    sessionId: string,
    promptId: string,
    response: PromptResponse,
  ): void {
    void sessionManager
      .resolvePrompt(sessionId, promptId, response)
      .then((res) => {
        if (!res.ok) {
          // Kode PROMPT_FAILED: client menampilkan error ini DI kartu prompt
          // (bukan banner global) agar klik yang gagal tidak terasa mati.
          sendSafe(sub, {
            type: "error",
            code: ErrorCodes.PROMPT_FAILED,
            message: friendlyPromptError(res.error ?? "ERROR"),
          });
          return;
        }
        notifyPromptResolved(sessionId, promptId);
      })
      .catch(() => {
        sendSafe(sub, {
          type: "error",
          code: ErrorCodes.PROMPT_FAILED,
          message: "Failed to send the answer to the agent. Try again.",
        });
      });
  }

  function stop(sub: Subscriber, sessionId: string): void {
    const res = sessionManager.stopSession(sessionId);
    if (!res.ok) {
      const code = toErrorCode(res.error ?? "");
      sendSafe(sub, { type: "error", code, message: res.error ?? "ERROR" });
    }
  }

  function interrupt(sub: Subscriber, sessionId: string): void {
    const res = sessionManager.interruptSession(sessionId);
    if (!res.ok) {
      const code = toErrorCode(res.error ?? "");
      sendSafe(sub, { type: "error", code, message: res.error ?? "ERROR" });
    }
  }

  function broadcast(sessionId: string, build: () => ServerMessage): void {
    for (const [sub, info] of subs) {
      if (info.sessionId !== sessionId) continue;
      sendSafe(sub, build());
    }
  }

  /**
   * Broadcast ke seluruh koneksi — dipakai pesan yang relevan lintas Session
   * (mis. `session_title`: pemilik koneksi mungkin sedang membuka daftar
   * Session, bukan me-attach satu Session).
   */
  function broadcastAll(build: () => ServerMessage): void {
    for (const sub of subs.keys()) {
      sendSafe(sub, build());
    }
  }

  function notifyMessage(sessionId: string, message: SessionMessage): void {
    broadcast(sessionId, () => ({ type: "message", sessionId, message }));
  }

  function notifyMessagePart(sessionId: string, messageId: string, part: MessagePart): void {
    broadcast(sessionId, () => ({ type: "message_part", sessionId, messageId, part }));
  }

  function notifyPrompt(sessionId: string, prompt: InteractivePrompt): void {
    broadcast(sessionId, () => ({ type: "prompt", sessionId, prompt }));
  }

  function notifySessionStatus(sessionId: string, status: SessionStatus): void {
    broadcast(sessionId, () => ({ type: "session_status", sessionId, status }));
  }

  function notifySessionTitle(sessionId: string, title: string): void {
    // `session_title` relevan bagi koneksi mana pun (daftar Session di
    // halaman Project), jadi dikirim ke semua koneksi — termasuk yang tidak
    // sedang attach satu Session.
    broadcastAll(() => ({ type: "session_title", sessionId, title }));
  }

  function notifyTurnActive(sessionId: string, active: boolean): void {
    broadcast(sessionId, () => ({ type: "turn_active", sessionId, active }));
  }

  /** Beri tahu subscriber bahwa Session sudah dihapus permanen. */
  function notifySessionDeleted(sessionId: string): void {
    broadcast(sessionId, () => ({ type: "session_deleted", sessionId }));
  }

  function notifyPromptResolved(sessionId: string, promptId: string): void {
    broadcast(sessionId, () => ({ type: "prompt_resolved", sessionId, promptId }));
  }

  function notifyError(sessionId: string, code: string, message: string): void {
    broadcast(sessionId, () => ({ type: "error", code, message }));
  }

  function detach(sub: Subscriber): void {
    subs.delete(sub);
  }

  function subscriberCount(sessionId: string): number {
    let n = 0;
    for (const info of subs.values()) {
      if (info.sessionId === sessionId) n += 1;
    }
    return n;
  }

  return {
    attach,
    input,
    promptResponse,
    stop,
    interrupt,
    notifyMessage,
    notifyMessagePart,
    notifyPrompt,
    notifySessionStatus,
    notifySessionTitle,
    notifyTurnActive,
    notifySessionDeleted,
    notifyPromptResolved,
    notifyError,
    detach,
    subscriberCount,
  };
}
