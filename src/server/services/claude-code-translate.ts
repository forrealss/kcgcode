/**
 * Penerjemah pesan Claude Agent SDK -> event bergaya opencode.
 *
 * Session_Manager & TurnStream dibangun di atas event SSE opencode
 * (`message.updated`, `message.part.updated`, `message.part.delta`,
 * `session.idle`, `session.error`, `session.status`). Agar backend Claude
 * Code bisa memakai jalur yang sama tanpa cabang khusus, setiap `SDKMessage`
 * diterjemahkan ke event tersebut di sini — fungsi/kelas murni tanpa I/O.
 *
 * Pemetaan (terverifikasi terhadap stream SDK 0.3.x):
 * - Satu turn = SATU pesan assistant lokal (`msg_<uuid>`); seluruh pesan API
 *   Anthropic dalam turn (termasuk sub-agent) menjadi parts pesan itu.
 * - `stream_event` text/thinking -> part `text`/`reasoning` + delta token.
 *   Pesan `assistant` membawa blok yang SAMA secara utuh: blok teks dari
 *   pesan API yang sudah di-stream dilewati agar tidak terduplikasi.
 * - `tool_use` (dari pesan `assistant`, input lengkap) -> part `tool`
 *   status running; `tool_result` (pesan `user`) -> status completed/error.
 * - Nama tool & key input dinormalisasi ke gaya opencode (`Read` -> `read`,
 *   `file_path` -> `filePath`) agar renderer, Reference, dan label izin
 *   yang sudah ada langsung bekerja.
 * - `system/api_retry` -> `session.status` retry (banner retry provider).
 */
import { randomUUID } from "node:crypto";
import type { MessagePart } from "../../types";
import type { OpenCodeEvent, OpenCodeTodo } from "./opencode-client";

/** Batas panjang output tool yang disimpan (hindari blob raksasa di DB). */
export const TOOL_OUTPUT_MAX_LENGTH = 50_000;

/** Nama tool Claude Code -> nama tool gaya opencode (dipakai UI). */
const TOOL_NAMES: Record<string, string> = {
  Read: "read",
  Write: "write",
  Edit: "edit",
  MultiEdit: "edit",
  NotebookEdit: "edit",
  Bash: "bash",
  BashOutput: "bash",
  Glob: "glob",
  Grep: "grep",
  LS: "list",
  WebFetch: "webfetch",
  WebSearch: "websearch",
  TodoWrite: "todowrite",
  Task: "task",
  Agent: "task",
  Skill: "skill",
  AskUserQuestion: "question",
};

/** Nama tool untuk part `tool` (tool MCP `mcp__server__tool` apa adanya). */
export function toolName(name: string): string {
  return TOOL_NAMES[name] ?? (name.startsWith("mcp__") ? name : name.toLowerCase());
}

/**
 * Nama permission gaya opencode untuk kartu izin — `parsePermissionTitle`
 * di UI memetakan nama ini ke label & tingkat risiko. Tool penulis file
 * dikelompokkan ke `edit` seperti di opencode.
 */
export function permissionName(name: string): string {
  const mapped = toolName(name);
  return mapped === "write" ? "edit" : mapped;
}

/** Salinan input tool dengan alias key gaya opencode (`filePath`). */
export function normalizeToolInput(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null) return {};
  const out: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  const path = out.file_path ?? out.notebook_path;
  if (typeof path === "string" && out.filePath === undefined) out.filePath = path;
  return out;
}

/** Target utama tool call untuk judul kartu izin (path/perintah/url). */
export function permissionTarget(input: Record<string, unknown>): string | null {
  for (const key of ["file_path", "notebook_path", "command", "url", "pattern", "path", "query"]) {
    const v = input[key];
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  return null;
}

/** Task list dari input `TodoWrite` (`{ todos: [{ content, status }] }`). */
export function todosFromInput(input: unknown): OpenCodeTodo[] | null {
  if (typeof input !== "object" || input === null) return null;
  const raw = (input as { todos?: unknown }).todos;
  if (!Array.isArray(raw)) return null;
  const out: OpenCodeTodo[] = [];
  for (const t of raw) {
    if (typeof t !== "object" || t === null) continue;
    const { content, status, priority } = t as Record<string, unknown>;
    if (typeof content !== "string") continue;
    out.push({
      content,
      status: typeof status === "string" ? status : "pending",
      // TodoWrite Claude Code tidak punya prioritas — UI tetap butuh nilai.
      priority: typeof priority === "string" ? priority : "medium",
    });
  }
  return out;
}

/** Teks dari konten `tool_result` (string atau array blok). */
export function toolResultText(content: unknown): string {
  let text: string;
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .map((b) => {
        if (typeof b !== "object" || b === null) return "";
        const block = b as { type?: unknown; text?: unknown };
        if (block.type === "text" && typeof block.text === "string") return block.text;
        if (block.type === "image") return "[image]";
        return "";
      })
      .filter((s) => s !== "")
      .join("\n");
  } else {
    text = "";
  }
  return text.length > TOOL_OUTPUT_MAX_LENGTH
    ? `${text.slice(0, TOOL_OUTPUT_MAX_LENGTH)}\n… (truncated)`
    : text;
}

/** Hasil sampingan satu pesan SDK yang perlu disimpan klien. */
export interface TranslateEffects {
  /** Task list terbaru (TodoWrite). */
  todos?: OpenCodeTodo[];
}

/** Blok streaming yang sedang dibangun (text/reasoning). */
interface StreamBlock {
  part: MessagePart;
  /**
   * Part sudah dikirim. Blok baru dikirim saat token pertama tiba: thinking
   * yang disembunyikan provider (tanpa delta) tidak menjadi part kosong.
   */
  emitted: boolean;
}

type Msg = Record<string, unknown>;

/**
 * Penerjemah stateful per Session Claude Code. `emit` menerima event gaya
 * opencode yang sudah memuat `sessionID`.
 */
export class ClaudeTurnTranslator {
  /** Id pesan assistant lokal turn aktif; null = belum ada turn. */
  private messageId: string | null = null;
  /** Id pesan API Anthropic yang teksnya sudah di-stream (lewati di `assistant`). */
  private readonly streamed = new Set<string>();
  /** Blok streaming aktif per pesan API: `${apiMsgId}:${index}` -> part. */
  private readonly blocks = new Map<string, StreamBlock>();
  /** Pesan API aktif per jalur (induk / sub-agent `parent_tool_use_id`). */
  private readonly currentApiMsg = new Map<string, string>();
  /** Part tool per tool_use id (untuk melengkapi hasilnya). */
  private readonly tools = new Map<string, MessagePart>();

  constructor(
    private readonly sessionID: string,
    private readonly emit: (ev: OpenCodeEvent) => void,
    private readonly now: () => number = Date.now,
  ) {}

  /** Mulai turn baru: pesan assistant lokal baru + `message.updated`. */
  beginTurn(): void {
    this.messageId = `msg_${randomUUID()}`;
    this.streamed.clear();
    this.blocks.clear();
    this.currentApiMsg.clear();
    this.tools.clear();
    this.emit({
      type: "message.updated",
      sessionID: this.sessionID,
      info: { id: this.messageId, role: "assistant" },
    });
  }

  /** Pastikan ada pesan assistant (event datang tanpa prompt dari bridge). */
  private ensureTurn(): string {
    if (this.messageId === null) this.beginTurn();
    return this.messageId as string;
  }

  private emitPart(part: MessagePart): void {
    const messageID = this.ensureTurn();
    this.emit({
      type: "message.part.updated",
      sessionID: this.sessionID,
      part: { ...part, messageID },
    });
  }

  private emitDelta(partID: string, delta: string): void {
    if (this.messageId === null || delta === "") return;
    this.emit({
      type: "message.part.delta",
      sessionID: this.sessionID,
      messageID: this.messageId,
      partID,
      field: "text",
      delta,
    });
  }

  /** Terjemahkan satu pesan SDK; kembalikan efek samping untuk klien. */
  handle(msg: Msg): TranslateEffects {
    switch (msg.type) {
      case "stream_event":
        this.handleStreamEvent(msg);
        return {};
      case "assistant":
        return this.handleAssistant(msg);
      case "user":
        this.handleUser(msg);
        return {};
      case "system":
        if (msg.subtype === "api_retry") this.handleRetry(msg);
        return {};
      default:
        return {};
    }
  }

  private handleStreamEvent(msg: Msg): void {
    const ev = msg.event as Msg | undefined;
    if (!ev || typeof ev.type !== "string") return;
    const lane = typeof msg.parent_tool_use_id === "string" ? msg.parent_tool_use_id : "";
    if (ev.type === "message_start") {
      const id = (ev.message as { id?: unknown } | undefined)?.id;
      if (typeof id === "string") {
        this.currentApiMsg.set(lane, id);
        this.streamed.add(id);
      }
      return;
    }
    const apiMsgId = this.currentApiMsg.get(lane);
    if (apiMsgId === undefined || typeof ev.index !== "number") return;
    const key = `${apiMsgId}:${ev.index}`;
    if (ev.type === "content_block_start") {
      const block = ev.content_block as { type?: unknown } | undefined;
      const type =
        block?.type === "text" ? "text" : block?.type === "thinking" ? "reasoning" : null;
      if (type === null) return; // tool_use dirakit dari pesan `assistant`
      const part: MessagePart = {
        id: `prt_${apiMsgId}_${ev.index}`,
        type,
        text: "",
        time: { start: this.now() },
      };
      this.blocks.set(key, { part, emitted: false });
      return;
    }
    const cur = this.blocks.get(key);
    if (!cur) return;
    if (ev.type === "content_block_delta") {
      const delta = ev.delta as { type?: unknown; text?: unknown; thinking?: unknown } | undefined;
      const piece =
        delta?.type === "text_delta" && typeof delta.text === "string"
          ? delta.text
          : delta?.type === "thinking_delta" && typeof delta.thinking === "string"
            ? delta.thinking
            : "";
      if (piece === "") return;
      if (!cur.emitted) {
        cur.emitted = true;
        this.emitPart(cur.part);
      }
      cur.part = { ...cur.part, text: `${cur.part.text ?? ""}${piece}` };
      this.emitDelta(cur.part.id as string, piece);
      return;
    }
    if (ev.type === "content_block_stop") {
      this.blocks.delete(key);
      if (!cur.emitted) return; // tanpa token sama sekali
      cur.part = { ...cur.part, time: { ...cur.part.time, end: this.now() } };
      this.emitPart(cur.part);
    }
  }

  private handleAssistant(msg: Msg): TranslateEffects {
    const message = msg.message as { id?: unknown; content?: unknown } | undefined;
    if (!message || !Array.isArray(message.content)) return {};
    const apiMsgId = typeof message.id === "string" ? message.id : null;
    const wasStreamed = apiMsgId !== null && this.streamed.has(apiMsgId);
    const uuid = typeof msg.uuid === "string" ? msg.uuid : randomUUID();
    const effects: TranslateEffects = {};
    message.content.forEach((raw, i) => {
      if (typeof raw !== "object" || raw === null) return;
      const block = raw as Msg;
      if (block.type === "text" || block.type === "thinking") {
        // Sudah tampil lewat stream_event — jangan diulang.
        if (wasStreamed) return;
        const text = block.type === "text" ? block.text : block.thinking;
        if (typeof text !== "string" || text === "") return;
        const t = this.now();
        this.emitPart({
          id: `prt_${uuid}_${i}`,
          type: block.type === "text" ? "text" : "reasoning",
          text,
          time: { start: t, end: t },
        });
        return;
      }
      if (block.type === "tool_use" || block.type === "server_tool_use") {
        if (typeof block.id !== "string" || typeof block.name !== "string") return;
        const input = normalizeToolInput(block.input);
        const part: MessagePart = {
          id: `prt_${block.id}`,
          type: "tool",
          tool: toolName(block.name),
          callID: block.id,
          state: { status: "running", input, time: { start: this.now() } },
        };
        this.tools.set(block.id, part);
        this.emitPart(part);
        if (block.name === "TodoWrite") {
          const todos = todosFromInput(block.input);
          if (todos) effects.todos = todos;
        }
      }
    });
    return effects;
  }

  private handleUser(msg: Msg): void {
    const message = msg.message as { content?: unknown } | undefined;
    if (!message || !Array.isArray(message.content)) return;
    for (const raw of message.content) {
      if (typeof raw !== "object" || raw === null) continue;
      const block = raw as Msg;
      if (block.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
      const part = this.tools.get(block.tool_use_id);
      if (!part) continue;
      const prev = (part.state ?? {}) as { input?: Record<string, unknown>; time?: unknown };
      const startedAt =
        typeof prev.time === "object" && prev.time !== null
          ? (prev.time as { start?: number }).start
          : undefined;
      const done: MessagePart = {
        ...part,
        state: {
          status: block.is_error === true ? "error" : "completed",
          input: prev.input,
          output: toolResultText(block.content),
          time: { start: startedAt, end: this.now() },
        },
      };
      this.tools.set(block.tool_use_id, done);
      this.emitPart(done);
    }
  }

  private handleRetry(msg: Msg): void {
    const status = typeof msg.error_status === "number" ? ` (HTTP ${msg.error_status})` : "";
    const reason = typeof msg.error === "string" ? msg.error.replace(/_/g, " ") : "request failed";
    this.emit({
      type: "session.status",
      sessionID: this.sessionID,
      status: {
        type: "retry",
        attempt: typeof msg.attempt === "number" ? msg.attempt : undefined,
        message: `${reason}${status}`,
      },
    });
  }
}
