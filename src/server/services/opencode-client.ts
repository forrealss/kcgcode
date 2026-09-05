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
import type { MessagePart, SessionModel } from "../../types";
import type { Result, SimpleResult } from "../result";

export interface OpenCodeSessionInfo {
  id: string;
  directory?: string;
}

/** Satu model yang tersedia pada sebuah provider (hasil GET /config/providers). */
export interface ModelOption {
  providerID: string;
  providerName: string;
  modelID: string;
  /** Nama tampilan (fallback: modelID). */
  name: string;
}

/**
 * Flatten respons `GET /config/providers` menjadi satu entri per model.
 * Bentuk sumber: `{ providers: [{ id, name, models: { [modelID]: {...} } }] }`.
 * Model berstatus `deprecated` disaring; provider tanpa model diabaikan.
 * Diekspor agar dapat diuji tanpa server.
 */
export function flattenProviders(payload: unknown): ModelOption[] {
  const providers = (payload as { providers?: unknown } | null)?.providers;
  if (!Array.isArray(providers)) return [];
  const out: ModelOption[] = [];
  for (const p of providers) {
    if (typeof p !== "object" || p === null) continue;
    const prov = p as { id?: unknown; name?: unknown; models?: unknown };
    if (typeof prov.id !== "string" || prov.id === "") continue;
    const providerName = typeof prov.name === "string" && prov.name !== "" ? prov.name : prov.id;
    const models =
      typeof prov.models === "object" && prov.models !== null
        ? (prov.models as Record<string, unknown>)
        : {};
    for (const [modelID, raw] of Object.entries(models)) {
      const m = (typeof raw === "object" && raw !== null ? raw : {}) as {
        name?: unknown;
        status?: unknown;
      };
      if (m.status === "deprecated") continue;
      out.push({
        providerID: prov.id,
        providerName,
        modelID,
        name: typeof m.name === "string" && m.name !== "" ? m.name : modelID,
      });
    }
  }
  return out;
}

export interface OpenCodeMessageResult {
  info: { id: string; role: string; [k: string]: unknown };
  parts: MessagePart[];
}

export type OpenCodePermissionReply = "once" | "always" | "reject";

/** Referensi file untuk part `file` prompt: `@file` teks maupun gambar. */
export interface OpenCodeFileRef {
  /** Nama tampilan part (path relatif project / nama file asli upload). */
  filename: string;
  /** MIME part — `text/plain` untuk @file, `image/*` untuk gambar. */
  mime: string;
  /** URL absolut yang dibaca opencode (`file:///abs/path`). */
  url: string;
}

/** Satu event SSE hasil normalisasi (properties digabung ke level atas). */
export interface OpenCodeEvent {
  type: string;
  id?: string;
  [k: string]: unknown;
}

export interface OpenCodeClient {
  createSession(opts?: { title?: string }): Promise<Result<OpenCodeSessionInfo>>;
  /**
   * Cek keberadaan Session di server headless (`GET /session/{id}`):
   * `{ ok: true }` bila Session masih dikenal server, `{ ok: false }`
   * bila tidak ada / server gagal merespons.
   */
  getSession(sessionId: string): Promise<SimpleResult>;
  /** Daftar model yang tersedia pada server (`GET /config/providers`),
   * sudah di-flatten menjadi satu entri per model.
   */
  listModels(): Promise<Result<ModelOption[]>>;
  /**
   * Hapus Session di server headless (`DELETE /session/{id}`) beserta
   * seluruh riwayat pesannya di sisi opencode.
   */
  deleteSession(sessionId: string): Promise<SimpleResult>;
  sendMessage(
    sessionId: string,
    text: string,
    signal?: AbortSignal,
  ): Promise<Result<OpenCodeMessageResult>>;
  /**
   * Kirim prompt tanpa menunggu balasan (`POST /session/{id}/prompt_async`,
   * 204). `model` disertakan dalam body agar Session memakai model pilihan
   * user, bukan model default opencode.
   */
  /**
   * Kirim prompt tanpa menunggu balasan (`POST /session/{id}/prompt_async`,
   * 204). `files` berupa referensi file (teks `@file` maupun gambar) —
   * opencode mem-parse `url` part file dengan `URL()` dan membaca isinya
   * sendiri, sehingga `url` harus path absolut (`file:///abs/path`).
   */
  promptAsync(
    sessionId: string,
    text: string,
    model?: SessionModel | null,
    files?: OpenCodeFileRef[],
  ): Promise<Result<null>>;
  /** Cari file project untuk autocomplete `@file` (path relatif). */
  findFiles(query: string): Promise<Result<string[]>>;
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

  async function getSession(sessionId: string): Promise<SimpleResult> {
    try {
      const { status } = await requestJson(
        baseUrl,
        "GET",
        `/session/${sessionId}`,
        undefined,
        AbortSignal.timeout(5000),
      );
      return status === 200 ? { ok: true } : errResult(`OC_SESSION_NOT_FOUND(${status})`);
    } catch (e) {
      return errResult(`OC_GET_SESSION_FAILED: ${(e as Error).message}`);
    }
  }

  async function createSession(
    opts: { title?: string } = {},
  ): Promise<Result<OpenCodeSessionInfo>> {
    try {
      const { status, json } = await requestJson(baseUrl, "POST", "/session", {
        title: opts.title ?? "KCG Code Session",
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

  async function promptAsync(
    sessionId: string,
    text: string,
    model?: SessionModel | null,
    files: OpenCodeFileRef[] = [],
  ): Promise<Result<null>> {
    try {
      // Parts prompt: teks bebas + satu part `file` per referensi (teks/gambar).
      const parts: Record<string, unknown>[] = [{ type: "text", text }];
      for (const f of files) {
        parts.push({ type: "file", mime: f.mime, filename: f.filename, url: f.url });
      }
      const body: Record<string, unknown> = { parts };
      // Skema prompt_async menerima `model: { providerID, modelID }` opsional;
      // tanpa field ini opencode memakai model default-nya.
      if (model) body.model = { providerID: model.providerID, modelID: model.modelID };
      const { status } = await requestJson(
        baseUrl,
        "POST",
        `/session/${sessionId}/prompt_async`,
        body,
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

  /**
   * Cari file di project (`GET /find/file?query=`) — dipakai autocomplete
   * referensi `@file` di composer. Mengembalikan path relatif project.
   */
  async function findFiles(query: string): Promise<Result<string[]>> {
    try {
      const { status, json } = await requestJson(
        baseUrl,
        "GET",
        `/find/file?query=${encodeURIComponent(query)}`,
        undefined,
        AbortSignal.timeout(5000),
      );
      if (status !== 200) return errResult(`OC_FIND_FILES_FAILED(${status})`);
      const raw = Array.isArray(json) ? json : [];
      const out: string[] = [];
      for (const item of raw) {
        if (typeof item === "string" && item.length > 0) out.push(item);
      }
      return { ok: true, data: out };
    } catch (e) {
      return errResult(`OC_FIND_FILES_FAILED: ${(e as Error).message}`);
    }
  }

  async function listModels(): Promise<Result<ModelOption[]>> {
    try {
      const { status, json } = await requestJson(baseUrl, "GET", "/config/providers");
      if (status !== 200) return errResult(`OC_LIST_MODELS_FAILED(${status})`);
      return { ok: true, data: flattenProviders(json) };
    } catch (e) {
      return errResult(`OC_LIST_MODELS_FAILED: ${(e as Error).message}`);
    }
  }

  async function deleteSession(sessionId: string): Promise<SimpleResult> {
    try {
      const { status } = await requestJson(
        baseUrl,
        "DELETE",
        `/session/${sessionId}`,
        undefined,
        AbortSignal.timeout(10_000),
      );
      // 200 = terhapus. 404 dianggap sukses: target sudah tidak ada (idemoten
      // terhadap storage opencode yang mungkin sudah dibersihkan manual).
      return status === 200 || status === 404
        ? { ok: true }
        : errResult(`OC_DELETE_SESSION_FAILED(${status})`);
    } catch (e) {
      return errResult(`OC_DELETE_SESSION_FAILED: ${(e as Error).message}`);
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
    getSession,
    listModels,
    deleteSession,
    sendMessage,
    promptAsync,
    findFiles,
    replyPermission,
    replyQuestion,
    rejectQuestion,
    abortSession,
    subscribeEvents,
    health,
  };
}
