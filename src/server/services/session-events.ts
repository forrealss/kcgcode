/**
 * Interpretasi event agent (bentuk opencode v2) — fungsi murni (tanpa state).
 *
 * Dipisah dari `session-manager.ts` agar dapat diuji & dibaca tersendiri:
 * - Pemetaan `permission.asked` / `form.created` menjadi `InteractivePrompt`
 *   + kunci pengelompokan kartu kembar, dan jawaban kartu kembali ke
 *   `AgentFormAnswer`.
 * - Deskripsi ramah error terstruktur (`AgentError`), retry provider, dan
 *   kegagalan kirim prompt.
 */
import {
  type InteractivePrompt,
  normalizePromptOptions,
  type PromptQuestion,
  type PromptResponse,
} from "../../types";
import type { AgentError, AgentForm, AgentFormAnswer, AgentFormField } from "../agents/types";

/** Deskripsi singkat sebuah permission request untuk judul kartu. */
export function describePermission(action: string, resources: readonly string[]): string {
  const parts: string[] = [];
  if (action.trim() !== "") parts.push(action);
  for (const r of resources.slice(0, 3)) {
    if (typeof r === "string" && r !== "") parts.push(`\`${r}\``);
  }
  return parts.length > 0 ? parts.join(" — ") : "Izin tool";
}

/** Baris pertama pesan error (sisanya sering stack trace / body JSON). */
function firstLine(text: string): string {
  return text.split("\n")[0]?.trim() ?? "";
}

/**
 * Deskripsi ramah error terstruktur agent (opencode v2 `SessionStructuredError`
 * / error Claude Code). Kategori dipetakan ke petunjuk yang bisa dibaca
 * user; pesan asli (baris pertama) disertakan karena sering lebih informatif.
 */
export function describeAgentError(error: AgentError | undefined): string {
  const type = (error?.type ?? "").toLowerCase();
  const line = firstLine(error?.message ?? "");
  const hint = (() => {
    if (type === "aborted") return "Prompt processing was aborted.";
    if (type.includes("auth"))
      return "Model provider authentication failed. Check the agent login.";
    if (type.includes("overflow") || type.includes("context")) {
      return "The conversation context exceeded the model limit. Start a new session or compact.";
    }
    if (type.includes("length")) return "The model output exceeded the message length limit.";
    if (type.includes("filter")) return "The model response was blocked by a content filter.";
    if (type.includes("transport")) return "Couldn't reach the model provider.";
    if (type.startsWith("provider") || type.includes("api")) {
      return "The model provider returned an error. Try again or switch models.";
    }
    return null;
  })();
  if (hint === null) return line || "Something went wrong while processing the prompt.";
  return line ? `${hint} — ${line}` : hint;
}

/** Panjang aman untuk teks retry yang dimasukkan ke banner. */
const BANNER_MAX_LENGTH = 240;

/**
 * Pesan banner saat provider model sedang di-retry (`session.retry.scheduled`).
 * Selama retry turn TETAP berjalan (backoff bisa lama karena `retry-after`) —
 * tanpa banner ini Client menunggu diam-diam.
 */
export function retryMessage(attempt: number | undefined, error: AgentError | undefined): string {
  const raw = firstLine(error?.message ?? "") || "request failed";
  const clipped = raw.length > BANNER_MAX_LENGTH ? `${raw.slice(0, BANNER_MAX_LENGTH)}…` : raw;
  const n = typeof attempt === "number" ? ` (attempt ${attempt})` : "";
  return `The model provider is retrying${n}: ${clipped}`;
}

/** Terjemahkan kode error pengiriman prompt ke pesan yang bisa dibaca user. */
export function friendlySendError(raw: string): string {
  const r = raw.trim();
  if (r === "TURN_TIMEOUT") {
    return "The model stopped responding — no activity for 5 minutes. Try sending the message again.";
  }
  // Kegagalan langkah kirim (switch model/agent, instruksi, prompt).
  const prompt = r.match(/^AGENT_[A-Z_]+_FAILED(?::\s*(.*))?$/s);
  if (prompt) {
    const detail = prompt[1] ? firstLine(prompt[1]) : "";
    return detail
      ? `Failed to send the prompt: ${detail}`
      : "Failed to send the prompt. Try again.";
  }
  const sendFail = r.match(/^SEND_FAILED:\s*(.*)$/s);
  if (sendFail) {
    const detail = sendFail[1] ? firstLine(sendFail[1]) : "";
    return detail
      ? `Failed to send the prompt: ${detail}`
      : "Failed to send the prompt: the agent connection is having trouble.";
  }
  return firstLine(r) || r;
}

// Placeholder & deriveSessionTitle hidup di lib/session-title.ts (dipakai Client & Server).
export {
  deriveSessionTitle,
  displaySessionTitle,
  isPlaceholderTitle,
  SESSION_TITLE_PLACEHOLDERS,
} from "@/lib/session-title";

/** Bangun Interactive_Prompt dari `permission.asked`. */
export function promptFromPermission(
  data: { id: string; action: string; resources: readonly string[] },
  sessionId: string,
  now: number,
): InteractivePrompt {
  return {
    id: data.id,
    sessionId,
    kind: "permission",
    type: "confirmation",
    title: describePermission(data.action, data.resources),
    options: null,
    status: "pending",
    createdAt: now,
    resolvedAt: null,
  };
}

/** Field form yang tampil ke user (field tersembunyi dilewati). */
export function visibleFields(form: AgentForm): AgentFormField[] {
  return form.fields.filter((f) => f.hidden !== true);
}

/** Opsi tampilan sebuah field: opsi eksplisit, atau Yes/No untuk boolean. */
function fieldOptions(field: AgentFormField): { label: string; description?: string }[] {
  if (field.options && field.options.length > 0) return field.options;
  if (field.type === "boolean") return [{ label: "Yes" }, { label: "No" }];
  return [];
}

/**
 * Bangun Interactive_Prompt dari `form.created` (padanan v2 tool `question`).
 *
 * SELURUH field disimpan (`questions`) untuk kartu multi-question; field
 * pertama juga disalin ke field legacy (title/options/multiple/custom) agar
 * kartu & data DB lama tetap bekerja.
 */
export function promptFromForm(form: AgentForm, sessionId: string, now: number): InteractivePrompt {
  const list: PromptQuestion[] = visibleFields(form).map((f) => {
    const options = normalizePromptOptions(fieldOptions(f));
    return {
      question: f.description ?? f.title ?? form.title,
      header: f.description ? (f.title ?? null) : null,
      options,
      multiple: f.type === "multiselect" ? true : undefined,
      // Field tanpa opsi hanya bisa dijawab bebas.
      custom: options.length === 0 ? true : f.custom !== false,
    };
  });
  const first = list[0] ?? null;
  const firstOptions = first?.options ?? [];
  return {
    id: form.id,
    sessionId,
    kind: "question",
    type: "menu",
    title: first?.question ?? form.title,
    options: firstOptions.length > 0 ? firstOptions : null,
    multiple: first?.multiple,
    custom: first?.custom !== false,
    questions: list.length > 1 ? list : undefined,
    status: "pending",
    createdAt: now,
    resolvedAt: null,
  };
}

/** Nilai satu field dari label-label terpilih user. */
function fieldValue(field: AgentFormField, labels: readonly string[]) {
  const options = field.options ?? [];
  const optionValue = (label: string) => options.find((o) => o.label === label)?.value ?? label;
  if (field.type === "multiselect") return labels.map(optionValue);
  const label = labels[0] ?? "";
  if (field.type === "boolean") return /^(yes|true|y|1)$/i.test(label);
  if (field.type === "number" || field.type === "integer") {
    const n = Number(label);
    return Number.isFinite(n) ? n : label;
  }
  return optionValue(label);
}

/**
 * Ubah jawaban kartu question (label per pertanyaan) menjadi jawaban form.
 * Tanpa definisi form (mis. setelah restart server) dipakai kunci `q{i}` —
 * konvensi field tool `question` opencode & Claude Code — dengan label
 * sebagai nilai.
 */
export function formAnswerFromLabels(
  form: AgentForm | undefined,
  answers: readonly (readonly string[])[],
): AgentFormAnswer {
  const out: AgentFormAnswer = {};
  if (!form) {
    answers.forEach((labels, i) => {
      out[`q${i}`] = labels.length > 1 ? [...labels] : (labels[0] ?? "");
    });
    return out;
  }
  visibleFields(form).forEach((field, i) => {
    out[field.key] = fieldValue(field, answers[i] ?? []);
  });
  return out;
}

/** Label jawaban per pertanyaan dari respons kartu (null = bukan jawaban). */
export function labelsFromResponse(response: PromptResponse): string[][] | null {
  if (typeof response !== "object" || response === null) return null;
  if ("answers" in response) return response.answers;
  if ("options" in response) return [response.options];
  return [[response.option]];
}

/**
 * Kunci pengelompokan prompt permission yang identik.
 *
 * Agent memancarkan SATU request permission per tool call, tanpa
 * deduplikasi — meminta akses yang sama berulang membanjiri UI dengan kartu
 * identik. Request dengan kind + judul yang sama dianggap satu keputusan:
 * tampil sebagai SATU kartu, dan jawaban user diteruskan ke SELURUH request
 * anggota grup (fan-out di `resolvePrompt`) agar turn tidak menggantung.
 */
export function permissionGroupKey(p: InteractivePrompt): string {
  return `${p.kind}\u0000${p.title ?? ""}`;
}
