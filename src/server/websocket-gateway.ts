/**
 * WebSocket_Gateway — registrasi koneksi, reattach, broadcast, cursor per client.
 * Sesuai `design.md` — `websocket-gateway.ts`.
 *
 * Prinsip:
 * - `Map<Subscriber, { sessionId, lastSeqSent }>` menyimpan cursor **per
 *   koneksi** (bukan per-session) agar tiap Client independen (Req 5.2).
 * - Alur `attach`: (1) validasi `sessionId` ada di store — bila tidak, kirim
 *   `error` lalu `close()` (Req 4.3); (2) kirim `history` terurut `seq` ASC
 *   (Req 4.1); (3) set `lastSeqSent`; (4) kirim `prompt` untuk seluruh prompt
 *   `pending` (Req 4.4); (5) daftarkan sebagai subscriber live.
 * - `broadcast(sessionId, chunk)`: kirim hanya jika `chunk.seq > lastSeqSent`,
 *   update `lastSeqSent`, tangkap error `send` per-subscriber (hapus subscriber
 *   gagal) tanpa menghentikan iterasi ke subscriber lain (Req 4.2, 5.1, 5.3).
 *
 * `Subscriber` adalah abstraksi tipis di atas WebSocket agar seluruh logika
 * gateway dapat diuji dengan mock `ws.send` (batasan mocking `design.md`).
 */
import type { ServerWebSocket } from "bun";
import type { SessionStore } from "./db";
import type { SessionManager } from "./session-manager";
import type { InteractivePrompt, OutputChunk, PromptResponse, SessionStatus } from "./types";
import { ErrorCodes, type ServerMessage } from "./ws-protocol";

/** Abstraksi koneksi — diimplementasikan oleh `bunWsSubscriber` atau mock test. */
export interface Subscriber {
  send(msg: ServerMessage): void;
  close(): void;
}

/** Cursor per-koneksi: Session yang di-attach + seq terakhir yang dikirim. */
export interface AttachedInfo {
  sessionId: string;
  lastSeqSent: number;
}

export interface WebSocketGatewayOptions {
  store: SessionStore;
  sessionManager: SessionManager;
}

export interface WebSocketGateway {
  /** Alur attach/reattach ke Session (Req 4.1, 4.3, 4.4). */
  attach(sub: Subscriber, sessionId: string): void;
  /** Wire pesan `input` ke Session_Manager (Req 7.1). */
  input(sub: Subscriber, sessionId: string, text: string): void;
  /** Wire pesan `prompt_response` ke Session_Manager + notifikasi resolved (Req 6.3). */
  promptResponse(
    sub: Subscriber,
    sessionId: string,
    promptId: string,
    response: PromptResponse,
  ): void;
  /** Wire pesan `resize` ke Session_Manager. */
  resize(sub: Subscriber, sessionId: string, cols: number, rows: number): void;
  /** Broadcast Output_Stream baru ke subscriber Session (Req 4.2, 5.1, 5.3). */
  broadcast(sessionId: string, chunk: OutputChunk): void;
  /** Kirim Interactive_Prompt baru ke subscriber Session. */
  notifyPrompt(sessionId: string, prompt: InteractivePrompt): void;
  /** Kirim notifikasi perubahan status ke subscriber Session (task 17.5). */
  notifySessionStatus(sessionId: string, status: SessionStatus): void;
  /** Kirim notifikasi prompt resolved ke subscriber Session (task 17.5). */
  notifyPromptResolved(sessionId: string, promptId: string): void;
  /** Hapus koneksi dari registry (dipanggil saat WS close). */
  detach(sub: Subscriber): void;
  /** Jumlah subscriber aktif sebuah Session (untuk verifikasi). */
  subscriberCount(sessionId: string): number;
}

/** Pemetaan error domain Session_Manager ke kode protokol `error`. */
function toErrorCode(error: string): string {
  if (error === ErrorCodes.SESSION_NOT_FOUND) return ErrorCodes.SESSION_NOT_FOUND;
  if (error === "SESSION_NOT_RUNNING" || error === "SESSION_NOT_ACTIVE") {
    return ErrorCodes.SESSION_NOT_RUNNING;
  }
  if (error === "TEXT_EMPTY" || error === "TEXT_TOO_LONG") return ErrorCodes.INVALID_TEXT;
  if (error === ErrorCodes.PROMPT_NOT_FOUND) return ErrorCodes.PROMPT_NOT_FOUND;
  if (error === ErrorCodes.PROMPT_ALREADY_RESOLVED) return ErrorCodes.PROMPT_ALREADY_RESOLVED;
  if (error === "INVALID_PROMPT_OPTION" || error === "INVALID_PROMPT_RESPONSE") {
    return ErrorCodes.INVALID_RESPONSE;
  }
  if (error === "INVALID_SIZE") return ErrorCodes.INVALID_SIZE;
  return "ERROR";
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
    // (1) validasi Session ada di store (Req 4.3)
    const sess = store.getSession(sessionId);
    if (!sess.ok) {
      sendSafe(sub, {
        type: "error",
        code: ErrorCodes.SESSION_NOT_FOUND,
        message: "Session tidak ditemukan",
      });
      sub.close();
      return;
    }

    // (2) riwayat Output_Stream terurut seq ASC (Req 4.1)
    const chunks = store.getOutputChunks(sessionId);
    if (!chunks.ok) {
      sendSafe(sub, { type: "error", code: "STORE_ERROR", message: chunks.error });
      sub.close();
      return;
    }
    const history = chunks.data.map((c) => ({ seq: c.seq, data: c.data, ts: c.ts }));
    const last = history[history.length - 1];
    const lastSeq = last?.seq ?? 0;
    // Bila kiriman history gagal, jangan daftarkan subscriber yang rusak.
    if (!sendSafe(sub, { type: "history", sessionId, chunks: history })) return;

    // (4) seluruh prompt belum resolved (Req 4.4)
    for (const prompt of store.listPendingPrompts(sessionId)) {
      sendSafe(sub, { type: "prompt", sessionId, prompt });
    }

    // (5) daftarkan sebagai subscriber live dengan cursor per-koneksi
    subs.set(sub, { sessionId, lastSeqSent: lastSeq });
  }

  function input(sub: Subscriber, sessionId: string, text: string): void {
    const res = sessionManager.sendFreeTextInput(sessionId, text);
    if (!res.ok) {
      const code = toErrorCode(res.error ?? "");
      sendSafe(sub, { type: "error", code, message: res.error ?? "ERROR" });
    }
  }

  function promptResponse(
    sub: Subscriber,
    sessionId: string,
    promptId: string,
    response: PromptResponse,
  ): void {
    const res = sessionManager.resolvePrompt(sessionId, promptId, response);
    if (!res.ok) {
      const code = toErrorCode(res.error ?? "");
      sendSafe(sub, { type: "error", code, message: res.error ?? "ERROR" });
      return;
    }
    notifyPromptResolved(sessionId, promptId);
  }

  function resize(sub: Subscriber, sessionId: string, cols: number, rows: number): void {
    const res = sessionManager.resizeSession(sessionId, cols, rows);
    if (!res.ok) {
      const code = toErrorCode(res.error ?? "");
      sendSafe(sub, { type: "error", code, message: res.error ?? "ERROR" });
    }
  }

  function broadcast(sessionId: string, chunk: OutputChunk): void {
    for (const [sub, info] of subs) {
      if (info.sessionId !== sessionId) continue;
      if (chunk.seq <= info.lastSeqSent) continue; // jangan kirim ulang (Req 4.2)
      const ok = sendSafe(sub, {
        type: "output",
        sessionId,
        seq: chunk.seq,
        data: chunk.data,
        ts: chunk.ts,
      });
      if (ok) info.lastSeqSent = chunk.seq;
    }
  }

  function notifyPrompt(sessionId: string, prompt: InteractivePrompt): void {
    for (const [sub, info] of subs) {
      if (info.sessionId !== sessionId) continue;
      sendSafe(sub, { type: "prompt", sessionId, prompt });
    }
  }

  function notifySessionStatus(sessionId: string, status: SessionStatus): void {
    for (const [sub, info] of subs) {
      if (info.sessionId !== sessionId) continue;
      sendSafe(sub, { type: "session_status", sessionId, status });
    }
  }

  function notifyPromptResolved(sessionId: string, promptId: string): void {
    for (const [sub, info] of subs) {
      if (info.sessionId !== sessionId) continue;
      sendSafe(sub, { type: "prompt_resolved", sessionId, promptId });
    }
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
    resize,
    broadcast,
    notifyPrompt,
    notifySessionStatus,
    notifyPromptResolved,
    detach,
    subscriberCount,
  };
}

// ---------------------------------------------------------------------------
// Adaptor + dispatch pesan Client -> Server
// ---------------------------------------------------------------------------

/** Adaptor ServerWebSocket Bun ke `Subscriber` (untuk wiring di `index.ts`). */
export function bunWsSubscriber(ws: ServerWebSocket): Subscriber {
  return {
    send(msg: ServerMessage) {
      ws.send(JSON.stringify(msg));
    },
    close() {
      ws.close(1000);
    },
  };
}

function isPromptResponse(r: unknown): r is PromptResponse {
  return (
    r === "approve" ||
    r === "deny" ||
    r === "cancel" ||
    (typeof r === "object" && r !== null && typeof (r as { option?: unknown }).option === "string")
  );
}

function invalidMessage(sub: Subscriber, detail: string): void {
  sub.send({ type: "error", code: "INVALID_MESSAGE", message: detail });
}

/**
 * Mem-parsing pesan Client dan meneruskan ke gateway sesuai `type`.
 * Pesan JSON rusak / payload salah bentuk -> `error` INVALID_MESSAGE.
 */
export function dispatchClientMessage(
  gateway: WebSocketGateway,
  sub: Subscriber,
  raw: string,
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    invalidMessage(sub, "Pesan JSON tidak valid");
    return;
  }
  if (typeof parsed !== "object" || parsed === null) {
    invalidMessage(sub, "Pesan harus berupa objek JSON");
    return;
  }
  const msg = parsed as Record<string, unknown>;
  switch (msg.type) {
    case "attach":
      if (typeof msg.sessionId === "string") gateway.attach(sub, msg.sessionId);
      else invalidMessage(sub, "attach membutuhkan sessionId string");
      break;
    case "input":
      if (typeof msg.sessionId === "string" && typeof msg.text === "string") {
        gateway.input(sub, msg.sessionId, msg.text);
      } else {
        invalidMessage(sub, "input membutuhkan sessionId dan text string");
      }
      break;
    case "prompt_response":
      if (
        typeof msg.sessionId === "string" &&
        typeof msg.promptId === "string" &&
        isPromptResponse(msg.response)
      ) {
        gateway.promptResponse(sub, msg.sessionId, msg.promptId, msg.response);
      } else {
        invalidMessage(sub, "prompt_response membutuhkan sessionId, promptId, dan response valid");
      }
      break;
    case "resize":
      if (
        typeof msg.sessionId === "string" &&
        typeof msg.cols === "number" &&
        typeof msg.rows === "number"
      ) {
        gateway.resize(sub, msg.sessionId, msg.cols, msg.rows);
      } else {
        invalidMessage(sub, "resize membutuhkan sessionId, cols, dan rows");
      }
      break;
    default:
      sub.send({
        type: "error",
        code: "UNKNOWN_MESSAGE_TYPE",
        message: "Tipe pesan tidak dikenal",
      });
  }
}
