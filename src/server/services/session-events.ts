/**
 * Interpretasi event SSE opencode — fungsi murni (tanpa state).
 *
 * Dipisah dari `session-manager.ts` agar dapat diuji & dibaca tersendiri:
 * - Pemetaan event `permission.asked` / `question.asked` (v1 & v2) menjadi
 *   `InteractivePrompt` + kunci pengelompokan kartu kembar.
 * - Deskripsi ramah error `session.error` dan kegagalan kirim prompt.
 */
import { randomUUID } from "node:crypto";
import type { InteractivePrompt } from "../../types";
import type { OpenCodeEvent } from "./opencode-client";

/** Ambil nilai field event dengan toleransi beberapa nama kunci. */
export function eventField(ev: OpenCodeEvent, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = ev[k];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

/**
 * Deskripsi singkat sebuah permission request untuk judul kartu.
 *
 * Menerima penamaan v1 (`permission` + `patterns`) maupun v2
 * (`action` + `resources`) — lihat `EventPermissionAsked` vs
 * `EventPermissionV2Asked` pada skema opencode.
 */
export function describePermission(ev: OpenCodeEvent): string {
  const permission = eventField(ev, "permission", "action", "name");
  const patterns = eventField(ev, "patterns", "resources");
  const parts: string[] = [];
  if (typeof permission === "string") parts.push(permission);
  if (Array.isArray(patterns)) {
    for (const p of patterns.slice(0, 3)) {
      if (typeof p === "string") parts.push(`\`${p}\``);
    }
  }
  return parts.length > 0 ? parts.join(" — ") : "Izin tool";
}

/**
 * Baris pertama pesan error dari event `session.error` opencode (bentuk SSE
 * ternormalisasi: `error: { name, data: { message } }`). Sisa `data.message`
 * berupa stack trace — tidak berguna untuk UI.
 */
export function sessionErrorMessage(ev: OpenCodeEvent): string {
  const err = eventField(ev, "error");
  if (typeof err !== "object" || err === null) return "";
  const e = err as { data?: { message?: unknown } };
  if (typeof e.data !== "object" || e.data === null) return "";
  const raw = e.data.message;
  if (typeof raw !== "string" || raw.trim() === "") return "";
  return raw.split("\n")[0]?.trim() ?? "";
}

/**
 * Deskripsi ramah event `session.error` opencode. Nama error (`error.name`)
 * dipetakan ke pesan Inggris yang bisa dibaca user; pesan asli (baris
 * pertama) disertakan bila ada karena sering lebih informatif
 * (mis. `TypeError: File URL host …`).
 */
export function describeSessionError(ev: OpenCodeEvent): string {
  const err = eventField(ev, "error");
  const name =
    typeof err === "object" && err !== null ? (err as { name?: unknown }).name : undefined;
  const line = sessionErrorMessage(ev);
  // Petunjuk ramah per nama error; null = pesan asli lebih informatif
  // (mis. `UnknownError` yang membawa TypeError asli).
  const hint = (() => {
    switch (name) {
      case "ProviderAuthError":
        return "Model provider authentication failed. Check the opencode login (`opencode auth`).";
      case "APIError":
        return "The model provider returned an API error. Try again or switch models.";
      case "ContentFilterError":
        return "The model response was blocked by a content filter.";
      case "ContextOverflowError":
        return "The conversation context exceeded the model limit. Start a new session or compact.";
      case "MessageOutputLengthError":
        return "The model output exceeded the message length limit.";
      case "MessageAbortedError":
        return "Prompt processing was aborted.";
      case "StructuredOutputError":
        return "Failed to parse the model's structured output.";
      default:
        return null;
    }
  })();
  if (hint === null) return line || "Something went wrong while processing the prompt.";
  return line ? `${hint} — ${line}` : hint;
}

/** Panjang aman untuk teks retry/error yang dimasukkan ke banner (hindari JSON blob raksasa). */
const BANNER_MAX_LENGTH = 240;

/**
 * Pesan ramah dari event `session.status` opencode bertipe `retry`
 * (`status: { type: "retry", attempt, message, action }`).
 *
 * Saat provider model mengembalikan error yang bisa dicoba ulang (rate limit,
 * kredit habis, cooldown akun, 5xx), opencode TIDAK langsung gagal — ia retry
 * dengan backoff (hingga 5 percobaan, menghormati header `retry-after` yang
 * bisa sangat lama). Selama retry hanya event `session.status` yang dipancarkan
 * (`busy`/`retry`), tanpa `session.error`/`session.idle` — tanpa banner ini,
 * Client diam-diam menunggu sampai retry habis atau batas idle turn.
 *
 * Mengembalikan `null` untuk status non-retry agar pemanggil cukup memfilter.
 */
export function retryStatusMessage(status: unknown): string | null {
  if (typeof status !== "object" || status === null) return null;
  const s = status as { type?: unknown; attempt?: unknown; message?: unknown; action?: unknown };
  if (s.type !== "retry") return null;
  // Upsell (mis. "Free limit reached") membawa `action.title` yang lebih
  // ringkas daripada `message` mentah (yang bisa berupa JSON body error).
  const action =
    typeof s.action === "object" && s.action !== null
      ? (s.action as { title?: unknown; message?: unknown })
      : undefined;
  const raw =
    typeof action?.title === "string" && action.title.trim() !== ""
      ? action.title
      : typeof s.message === "string" && s.message.trim() !== ""
        ? s.message
        : null;
  if (raw === null) return null;
  const attempt = typeof s.attempt === "number" ? ` (attempt ${s.attempt})` : "";
  const text = raw.split("\n")[0]?.trim() ?? raw;
  const clipped = text.length > BANNER_MAX_LENGTH ? `${text.slice(0, BANNER_MAX_LENGTH)}…` : text;
  return `The model provider is retrying${attempt}: ${clipped}`;
}

/** Terjemahkan kode error pengiriman prompt ke pesan yang bisa dibaca user. */
export function friendlySendError(raw: string): string {
  const r = raw.trim();
  if (r === "TURN_TIMEOUT") {
    return "The model stopped responding — no activity for 5 minutes. Try sending the message again.";
  }
  const asyncMatch = r.match(/^OC_PROMPT_ASYNC_FAILED(?:\((\d+)\))?(?::\s*(.*))?$/);
  if (asyncMatch) {
    const status = asyncMatch[1];
    const detail = asyncMatch[2];
    if (status) return `Failed to send the prompt to opencode (status ${status}). Try again.`;
    if (detail)
      return `Failed to send the prompt to opencode: ${detail.split("\n")[0]?.trim() ?? detail}`;
    return "Failed to send the prompt to opencode. Try again.";
  }
  const sendFail = r.match(/^SEND_FAILED:\s*(.*)$/);
  if (sendFail) {
    const detail = sendFail[1];
    return detail
      ? `Failed to send the prompt: ${detail.split("\n")[0]?.trim() ?? detail}`
      : "Failed to send the prompt: the opencode connection is having trouble.";
  }
  return r.split("\n")[0] ?? r;
}

/** Bangun Interactive_Prompt dari event `permission.asked` (lihat juga `permissionGroupKey`). */
export function promptFromPermission(
  ev: OpenCodeEvent,
  sessionId: string,
  now: number,
): InteractivePrompt {
  const requestId = String(eventField(ev, "requestID", "id") ?? randomUUID());
  return {
    id: requestId,
    sessionId,
    kind: "permission",
    type: "confirmation",
    title: describePermission(ev),
    options: null,
    status: "pending",
    createdAt: now,
    resolvedAt: null,
  };
}

/** Bangun Interactive_Prompt dari event `question.asked` (pertanyaan pertama). */
export function promptFromQuestion(
  ev: OpenCodeEvent,
  sessionId: string,
  now: number,
): InteractivePrompt {
  const requestId = String(eventField(ev, "requestID", "id") ?? randomUUID());
  const questions = eventField(ev, "questions");
  const first =
    Array.isArray(questions) && questions.length > 0
      ? (questions[0] as {
          question?: unknown;
          options?: unknown;
          custom?: unknown;
        })
      : null;
  const options =
    first && Array.isArray(first.options)
      ? first.options
          .map((o) => (typeof o === "object" && o !== null ? (o as { label?: unknown }).label : o))
          .filter((l): l is string => typeof l === "string")
      : [];
  return {
    id: requestId,
    sessionId,
    kind: "question",
    type: "menu",
    title: first && typeof first.question === "string" ? first.question : null,
    options: options.length > 0 ? options : null,
    custom: first?.custom !== false,
    status: "pending",
    createdAt: now,
    resolvedAt: null,
  };
}

/**
 * Kunci pengelompokan prompt permission yang identik.
 *
 * opencode memancarkan SATU request permission per tool call, tanpa
 * deduplikasi — meminta akses yang sama berulang (mis. `bash` pada direktori
 * eksternal yang sama) membanjiri UI dengan kartu identik. Request dengan
 * kind + judul yang sama dianggap satu keputusan yang sama: tampil sebagai
 * SATU kartu, dan jawaban user diteruskan ke SELURUH request anggota grup
 * (fan-out di `resolvePrompt`) agar turn tidak menggantung.
 */
export function permissionGroupKey(p: InteractivePrompt): string {
  return `${p.kind}\u0000${p.title ?? ""}`;
}
