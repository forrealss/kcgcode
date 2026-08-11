/**
 * OpenCode_Client — client HTTP + SSE ke server headless `opencode serve`.
 *
 * Menggantikan `pty-process.ts` (PTY/TUI): alih-alih menulis byte ke terminal,
 * percakapan dilakukan lewat API terstruktur:
 * - `POST /session`                     buat session (`ses_...`)
 * - `POST /session/{id}/message`        kirim prompt, balasan terstruktur
 * - `POST /session/{id}/prompt_async`   kirim prompt, balas 204 (hasil via SSE)
 * - `POST /permission/{id}/reply`       jawab izin tool (`once|always|reject`)
 * - `POST /question/{id}/reply|reject`  jawab pertanyaan
 * - `POST /session/{id}/abort`          hentikan turn berjalan
 * - `GET /event`                        SSE — event bertipe (permission.asked,
 *                                       question.asked, message.*, session.*)
 *
 * `subscribeEvents` menormalkan frame SSE `{ id, type, properties }` menjadi
 * `{ type, id, ...properties }` agar konsumen mudah membaca `requestID`,
 * `sessionID`, `permission`, `questions`, dst.
 */
import type { MessagePart, Result } from "./types";

export interface OpenCodeSessionInfo {
  id: string;
  directory?: string;
}

export interface OpenCodeMessageResult {
  info: { id: string; role: string; [k: string]: unknown };
  parts: MessagePart[];
}

export type OpenCodePermissionReply = "once" | "always" | "reject";

/** Satu event SSE hasil normalisasi (properties digabung ke level atas). */
export interface OpenCodeEvent {
  type: string;
  id?: string;
  [k: string]: unknown;
}

export interface OpenCodeClient {
  createSession(opts?: { title?: string }): Promise<Result<OpenCodeSessionInfo>>;
  sendMessage(
    sessionId: string,
    text: string,
    signal?: AbortSignal,
  ): Promise<Result<OpenCodeMessageResult>>;
  /**
   * Kirim prompt tanpa menunggu balasan (`POST /session/{id}/prompt_async`,
   * 204). Hasil turn diterima lewat SSE, jadi tidak ada koneksi HTTP berumur
   * panjang yang bisa putus di tengah turn.
   */
  promptAsync(sessionId: string, text: string): Promise<Result<null>>;
  replyPermission(requestId: string, reply: OpenCodePermissionReply): Promise<Result<unknown>>;
  replyQuestion(requestId: string, answers: string[]): Promise<Result<unknown>>;
  rejectQuestion(requestId: string): Promise<Result<unknown>>;
  abortSession(sessionId: string): Promise<Result<unknown>>;
  /** Subscribe event SSE; mengembalikan fungsi untuk berhenti subscribe. */
  subscribeEvents(cb: (ev: OpenCodeEvent) => void): () => void;
  health(): Promise<boolean>;
}

function errResult(msg: string): { ok: false; error: string } {
  return { ok: false, error: msg };
}

async function requestJson(
  baseUrl: string,
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* body kosong / bukan JSON */
  }
  return { status: res.status, json };
}

/** Parsing satu frame SSE: baris `data:` (dan `event:` bila ada). */
export function parseSseFrame(frame: string): string | null {
  const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
  if (!dataLine) return null;
  return dataLine.slice(5).trim();
}

/** Normalisasi payload event SSE `{ id, type, properties }` -> event datar. */
export function normalizeEvent(payload: unknown): OpenCodeEvent | null {
  if (typeof payload !== "object" || payload === null) return null;
  const raw = payload as Record<string, unknown>;
  if (typeof raw.type !== "string") return null;
  const props =
    typeof raw.properties === "object" && raw.properties !== null
      ? (raw.properties as Record<string, unknown>)
      : {};
  return { type: raw.type, ...(raw.id !== undefined ? { id: String(raw.id) } : {}), ...props };
}

export function createOpenCodeClient(baseUrl: string): OpenCodeClient {
  async function health(): Promise<boolean> {
    try {
      const res = await fetch(`${baseUrl}/global/health`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function createSession(
    opts: { title?: string } = {},
  ): Promise<Result<OpenCodeSessionInfo>> {
    try {
      const { status, json } = await requestJson(baseUrl, "POST", "/session", {
        title: opts.title ?? "KCG Bridge Session",
      });
      if (status !== 200) return errResult(`OC_CREATE_SESSION_FAILED(${status})`);
      const info = json as OpenCodeSessionInfo;
      if (typeof info?.id !== "string") return errResult("OC_CREATE_SESSION_FAILED");
      return { ok: true, data: info };
    } catch (e) {
      return errResult(`OC_CREATE_SESSION_FAILED: ${(e as Error).message}`);
    }
  }

  async function sendMessage(
    sessionId: string,
    text: string,
    signal?: AbortSignal,
  ): Promise<Result<OpenCodeMessageResult>> {
    try {
      const { status, json } = await requestJson(
        baseUrl,
        "POST",
        `/session/${sessionId}/message`,
        { parts: [{ type: "text", text }] },
        signal,
      );
      if (status !== 200) return errResult(`OC_SEND_MESSAGE_FAILED(${status})`);
      const body = json as OpenCodeMessageResult | null;
      if (!body || typeof body.info?.id !== "string" || !Array.isArray(body.parts)) {
        return errResult("OC_SEND_MESSAGE_FAILED: balasan tidak valid");
      }
      return { ok: true, data: body };
    } catch (e) {
      const err = e as Error & { name?: string };
      const name = err.name ?? "";
      const msg = err.message ?? "";
      if (name === "TimeoutError" || name === "AbortError" || /timed out|aborted/i.test(msg)) {
        return errResult("OC_SEND_MESSAGE_TIMEOUT");
      }
      return errResult(`OC_SEND_MESSAGE_FAILED: ${msg}`);
    }
  }

  async function promptAsync(sessionId: string, text: string): Promise<Result<null>> {
    try {
      const { status } = await requestJson(
        baseUrl,
        "POST",
        `/session/${sessionId}/prompt_async`,
        { parts: [{ type: "text", text }] },
        // Hanya menunggu penerimaan prompt (204), bukan seluruh turn.
        AbortSignal.timeout(30_000),
      );
      // 204 = prompt diterima; opencode juga membalas 200 pada versi tertentu.
      return status === 204 || status === 200
        ? { ok: true, data: null }
        : errResult(`OC_PROMPT_ASYNC_FAILED(${status})`);
    } catch (e) {
      return errResult(`OC_PROMPT_ASYNC_FAILED: ${(e as Error).message}`);
    }
  }

  async function replyPermission(
    requestId: string,
    reply: OpenCodePermissionReply,
  ): Promise<Result<unknown>> {
    try {
      const { status } = await requestJson(baseUrl, "POST", `/permission/${requestId}/reply`, {
        reply,
      });
      return status === 200
        ? { ok: true, data: null }
        : errResult(`OC_PERMISSION_REPLY_FAILED(${status})`);
    } catch (e) {
      return errResult(`OC_PERMISSION_REPLY_FAILED: ${(e as Error).message}`);
    }
  }

  async function replyQuestion(requestId: string, answers: string[]): Promise<Result<unknown>> {
    try {
      const { status } = await requestJson(
        baseUrl,
        "POST",
        `/question/${requestId}/reply`,
        answers,
      );
      return status === 200
        ? { ok: true, data: null }
        : errResult(`OC_QUESTION_REPLY_FAILED(${status})`);
    } catch (e) {
      return errResult(`OC_QUESTION_REPLY_FAILED: ${(e as Error).message}`);
    }
  }

  async function rejectQuestion(requestId: string): Promise<Result<unknown>> {
    try {
      const { status } = await requestJson(baseUrl, "POST", `/question/${requestId}/reject`, {});
      return status === 200
        ? { ok: true, data: null }
        : errResult(`OC_QUESTION_REJECT_FAILED(${status})`);
    } catch (e) {
      return errResult(`OC_QUESTION_REJECT_FAILED: ${(e as Error).message}`);
    }
  }

  async function abortSession(sessionId: string): Promise<Result<unknown>> {
    try {
      const { status } = await requestJson(baseUrl, "POST", `/session/${sessionId}/abort`, {});
      return status === 200 ? { ok: true, data: null } : errResult(`OC_ABORT_FAILED(${status})`);
    } catch (e) {
      return errResult(`OC_ABORT_FAILED: ${(e as Error).message}`);
    }
  }

  function subscribeEvents(cb: (ev: OpenCodeEvent) => void): () => void {
    let cancelled = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    void (async () => {
      while (!cancelled) {
        try {
          const res = await fetch(`${baseUrl}/event`);
          if (!res.ok || !res.body) {
            await Bun.sleep(1000);
            continue;
          }
          reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done || cancelled) break;
            buf += decoder.decode(value, { stream: true });
            const frames = buf.split("\n\n");
            buf = frames.pop() ?? "";
            for (const frame of frames) {
              const data = parseSseFrame(frame);
              if (data === null) continue;
              try {
                const ev = normalizeEvent(JSON.parse(data));
                if (ev) cb(ev);
              } catch {
                /* frame tidak valid — abaikan */
              }
            }
          }
        } catch {
          /* koneksi SSE terputus — coba lagi setelah jeda */
        }
        if (!cancelled) await Bun.sleep(1000);
      }
    })();
    return () => {
      cancelled = true;
      reader?.cancel().catch(() => {});
    };
  }

  return {
    createSession,
    sendMessage,
    promptAsync,
    replyPermission,
    replyQuestion,
    rejectQuestion,
    abortSession,
    subscribeEvents,
    health,
  };
}
