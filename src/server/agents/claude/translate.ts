/**
 * Penerjemah pesan Claude Agent SDK -> `AgentEvent` (bentuk opencode v2).
 *
 * Fungsi/kelas murni tanpa I/O. Pemetaan (terverifikasi terhadap stream SDK
 * 0.3.x):
 * - Satu turn = satu "step" dengan pesan assistant lokal (`msg_<uuid>`):
 *   `session.execution.started` + `session.step.started`. Seluruh pesan API
 *   Anthropic dalam turn (termasuk sub-agent) menjadi konten pesan itu.
 * - `stream_event` text/thinking -> `session.text.*` / `session.reasoning.*`
 *   (started saat token pertama, delta per token, ended dengan teks penuh).
 *   Pesan `assistant` membawa blok yang SAMA secara utuh: blok dari pesan API
 *   yang sudah di-stream dilewati agar tidak terduplikasi.
 * - `tool_use` -> `session.tool.input.started` + `session.tool.called`;
 *   `tool_result` -> `session.tool.success` / `session.tool.failed`.
 * - `system/api_retry` -> `session.retry.scheduled`.
 *
 * Nama tool & key input dinormalisasi (`Read` -> `read`, `file_path` ->
 * `filePath`) agar renderer, Reference, dan label izin langsung bekerja.
 */
import { randomUUID } from "node:crypto";
import type { TodoItem } from "../../../types";
import type { AgentEvent } from "../types";

/** Batas panjang output tool yang diteruskan (hindari blob raksasa di DB). */
export const TOOL_OUTPUT_MAX_LENGTH = 50_000;

/** Nama tool Claude Code -> nama tool yang dipakai UI. */
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
 * Nama permission untuk kartu izin — `parsePermissionTitle` di UI memetakan
 * nama ini ke label & tingkat risiko. Tool penulis file dikelompokkan ke
 * `edit`.
 */
export function permissionName(name: string): string {
  const mapped = toolName(name);
  return mapped === "write" ? "edit" : mapped;
}

/** Salinan input tool dengan alias key `filePath`. */
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
export function todosFromInput(input: unknown): TodoItem[] | null {
  if (typeof input !== "object" || input === null) return null;
  const raw = (input as { todos?: unknown }).todos;
  if (!Array.isArray(raw)) return null;
  const out: TodoItem[] = [];
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
  todos?: TodoItem[];
}

/** Blok streaming yang sedang dibangun (text/reasoning). */
interface StreamBlock {
  kind: "text" | "reasoning";
  ordinal: number;
  text: string;
  /** `*.started` sudah dikirim (token pertama sudah tiba). */
  started: boolean;
}

type Msg = Record<string, unknown>;

/** Penerjemah stateful per Session Claude Code. */
export class ClaudeTurnTranslator {
  /** Id pesan assistant lokal turn aktif; null = belum ada turn. */
  private messageId: string | null = null;
  /** Id pesan API Anthropic yang teksnya sudah di-stream (lewati di `assistant`). */
  private readonly streamed = new Set<string>();
  /** Blok streaming aktif per pesan API: `${apiMsgId}:${index}`. */
  private readonly blocks = new Map<string, StreamBlock>();
  /** Pesan API aktif per jalur (induk / sub-agent `parent_tool_use_id`). */
  private readonly currentApiMsg = new Map<string, string>();
  /** Ordinal berikutnya per jenis blok pada pesan lokal. */
  private ordinals = { text: 0, reasoning: 0 };

  constructor(
    private readonly sessionID: string,
    private readonly emit: (ev: AgentEvent) => void,
  ) {}

  /** Id pesan assistant turn aktif (null = belum ada turn). */
  get currentMessageId(): string | null {
    return this.messageId;
  }

  /** Mulai turn baru: eksekusi + step dengan pesan assistant lokal baru. */
  beginTurn(): void {
    this.messageId = `msg_${randomUUID()}`;
    this.streamed.clear();
    this.blocks.clear();
    this.currentApiMsg.clear();
    this.ordinals = { text: 0, reasoning: 0 };
    this.emit({ type: "session.execution.started", data: { sessionID: this.sessionID } });
    this.emit({
      type: "session.step.started",
      data: { sessionID: this.sessionID, assistantMessageID: this.messageId },
    });
  }

  /** Pastikan ada pesan assistant (event datang tanpa prompt dari bridge). */
  private ensureTurn(): string {
    if (this.messageId === null) this.beginTurn();
    return this.messageId as string;
  }

  /** Kirim satu blok teks utuh (tanpa streaming). */
  private emitWholeText(kind: "text" | "reasoning", text: string): void {
    const assistantMessageID = this.ensureTurn();
    const ordinal = this.ordinals[kind]++;
    const base = { sessionID: this.sessionID, assistantMessageID, ordinal };
    if (kind === "text") {
      this.emit({ type: "session.text.started", data: base });
      this.emit({ type: "session.text.ended", data: { ...base, text } });
    } else {
      this.emit({ type: "session.reasoning.started", data: base });
      this.emit({ type: "session.reasoning.ended", data: { ...base, text } });
    }
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
      const kind =
        block?.type === "text" ? "text" : block?.type === "thinking" ? "reasoning" : null;
      if (kind === null) return; // tool_use dirakit dari pesan `assistant`
      this.ensureTurn();
      this.blocks.set(key, { kind, ordinal: this.ordinals[kind]++, text: "", started: false });
      return;
    }
    const cur = this.blocks.get(key);
    if (!cur || this.messageId === null) return;
    const base = {
      sessionID: this.sessionID,
      assistantMessageID: this.messageId,
      ordinal: cur.ordinal,
    };
    if (ev.type === "content_block_delta") {
      const delta = ev.delta as { type?: unknown; text?: unknown; thinking?: unknown } | undefined;
      const piece =
        delta?.type === "text_delta" && typeof delta.text === "string"
          ? delta.text
          : delta?.type === "thinking_delta" && typeof delta.thinking === "string"
            ? delta.thinking
            : "";
      if (piece === "") return;
      if (!cur.started) {
        cur.started = true;
        this.emit({
          type: cur.kind === "text" ? "session.text.started" : "session.reasoning.started",
          data: base,
        });
      }
      cur.text += piece;
      this.emit({
        type: cur.kind === "text" ? "session.text.delta" : "session.reasoning.delta",
        data: { ...base, delta: piece },
      });
      return;
    }
    if (ev.type === "content_block_stop") {
      this.blocks.delete(key);
      if (!cur.started) return; // tanpa token sama sekali
      this.emit({
        type: cur.kind === "text" ? "session.text.ended" : "session.reasoning.ended",
        data: { ...base, text: cur.text },
      });
    }
  }

  private handleAssistant(msg: Msg): TranslateEffects {
    const message = msg.message as { id?: unknown; content?: unknown } | undefined;
    if (!message || !Array.isArray(message.content)) return {};
    const apiMsgId = typeof message.id === "string" ? message.id : null;
    const wasStreamed = apiMsgId !== null && this.streamed.has(apiMsgId);
    const effects: TranslateEffects = {};
    for (const raw of message.content) {
      if (typeof raw !== "object" || raw === null) continue;
      const block = raw as Msg;
      if (block.type === "text" || block.type === "thinking") {
        // Sudah tampil lewat stream_event — jangan diulang.
        if (wasStreamed) continue;
        const text = block.type === "text" ? block.text : block.thinking;
        if (typeof text !== "string" || text === "") continue;
        this.emitWholeText(block.type === "text" ? "text" : "reasoning", text);
        continue;
      }
      if (block.type === "tool_use" || block.type === "server_tool_use") {
        if (typeof block.id !== "string" || typeof block.name !== "string") continue;
        const assistantMessageID = this.ensureTurn();
        const name = toolName(block.name);
        const base = { sessionID: this.sessionID, assistantMessageID, id: block.id };
        this.emit({ type: "session.tool.input.started", data: { ...base, name } });
        this.emit({
          type: "session.tool.called",
          data: { ...base, name, input: normalizeToolInput(block.input) },
        });
        if (block.name === "TodoWrite") {
          const todos = todosFromInput(block.input);
          if (todos) effects.todos = todos;
        }
      }
    }
    return effects;
  }

  private handleUser(msg: Msg): void {
    const message = msg.message as { content?: unknown } | undefined;
    if (!message || !Array.isArray(message.content) || this.messageId === null) return;
    for (const raw of message.content) {
      if (typeof raw !== "object" || raw === null) continue;
      const block = raw as Msg;
      if (block.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
      const base = {
        sessionID: this.sessionID,
        assistantMessageID: this.messageId,
        id: block.tool_use_id,
      };
      const output = toolResultText(block.content);
      const content = output ? [{ type: "text", text: output }] : [];
      if (block.is_error === true) {
        this.emit({
          type: "session.tool.failed",
          data: { ...base, error: { type: "tool", message: output || "Tool failed" }, content },
        });
      } else {
        this.emit({ type: "session.tool.success", data: { ...base, content } });
      }
    }
  }

  private handleRetry(msg: Msg): void {
    const status = typeof msg.error_status === "number" ? ` (HTTP ${msg.error_status})` : "";
    const reason = typeof msg.error === "string" ? msg.error.replace(/_/g, " ") : "request failed";
    this.emit({
      type: "session.retry.scheduled",
      data: {
        sessionID: this.sessionID,
        attempt: typeof msg.attempt === "number" ? msg.attempt : 1,
        error: { type: "provider.retry", message: `${reason}${status}` },
      },
    });
  }
}
