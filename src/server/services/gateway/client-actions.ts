/**
 * Handler pesan dari Client: `attach` (reattach + `history`), `input`,
 * `prompt_response`, `stop`, dan `interrupt`.
 *
 * `input` / `prompt_response` asinkron (HTTP ke server headless); error
 * asinkron dilaporkan via pesan `error` ke Client pengirim saja. Attach ke
 * Session tidak ditemukan -> `error` + `close` (Requirement 4.3).
 */
import type { SessionStore } from "../../../db";
import type { PromptResponse } from "../../../types";
import { ErrorCodes } from "../../../ws-protocol";
import type { SessionManager } from "../session-manager";
import { friendlyPromptError, toErrorCode } from "./error-mapping";
import type { SubscriberRegistry } from "./subscriber-registry";
import type { Subscriber, WebSocketGateway } from "./types";

export interface ClientActionsDeps {
  store: SessionStore;
  sessionManager: SessionManager;
  registry: SubscriberRegistry;
  /** Broadcast `prompt_resolved` ke koneksi yang attach Session. */
  notifyPromptResolved(sessionId: string, promptId: string): void;
}

export type ClientActions = Pick<
  WebSocketGateway,
  "attach" | "input" | "promptResponse" | "stop" | "interrupt"
>;

export function createClientActions(deps: ClientActionsDeps): ClientActions {
  const { store, sessionManager, registry, notifyPromptResolved } = deps;
  const { sendSafe } = registry;

  function attach(sub: Subscriber, sessionId: string): void {
    // Mode daftar (sessionId kosong): tanpa `history`, cukup daftar sebagai
    // penerima broadcast global (`session_title`, `session_status`,
    // `session_deleted`).
    if (sessionId === "") {
      registry.register(sub, { sessionId: null });
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
    registry.register(sub, { sessionId });
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
        if (!res.ok && res.error === "PROMPT_EXPIRED") {
          // Prompt sudah ditutup secara lokal (agent tidak lagi menunggu):
          // hapus kartu di semua klien lalu beri tahu pengirim kenapa —
          // session kembali bisa dipakai (composer muncul lagi).
          notifyPromptResolved(sessionId, promptId);
          sendSafe(sub, {
            type: "error",
            code: ErrorCodes.PROMPT_EXPIRED,
            message: friendlyPromptError("PROMPT_EXPIRED"),
          });
          return;
        }
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

  return { attach, input, promptResponse, stop, interrupt };
}
