/**
 * Agent_Projector — proyeksi event agent (bentuk opencode v2) ke model
 * penyimpanan KCG Code.
 *
 * Event agent bersifat granular (`session.text.delta`, `session.tool.called`,
 * …); riwayat & UI KCG menyimpan `MessagePart` per pesan assistant. Projector
 * merakit part dari event lalu menyerahkannya ke `TurnStream`, memetakan
 * `permission.asked` / `form.created` ke Interactive_Prompt, dan judul
 * `session.renamed` ke Session lokal.
 *
 * Pemetaan part (stabil terhadap event ulang):
 * - text/reasoning ke-`ordinal` pesan `M` -> part `prt_M_text_<n>` /
 *   `prt_M_reasoning_<n>`; part dikirim saat token pertama (reasoning yang
 *   disembunyikan provider tidak menjadi part kosong), delta diteruskan
 *   sebagai `message.part.delta` field `text`, dan `*.ended` membawa teks
 *   final yang otoritatif.
 * - tool call `C` -> part `prt_C` (`type: "tool"`) dengan
 *   `state.status` pending -> running -> completed|error.
 *
 * Akhir turn hanya dari Session AKAR: sub-agent (child session) selesai lebih
 * dulu dari induknya.
 */
import type { InteractivePrompt, MessagePart } from "../../types";
import type { AgentEvent, AgentEventData, AgentForm, AgentToolContent } from "../agents/types";
import {
  describeAgentError,
  isPlaceholderTitle,
  promptFromForm,
  promptFromPermission,
  retryMessage,
} from "./session-events";
import type { TurnStream } from "./turn-stream";

/** Batas panjang output tool yang disimpan (hindari blob raksasa di DB). */
export const TOOL_OUTPUT_MAX_LENGTH = 50_000;

export interface AgentProjectorOptions {
  turns: TurnStream;
  now: () => number;
  /** Session lokal pemilik Session agent (induk maupun child sub-agent). */
  resolve(agentSessionID: string): string | undefined;
  /** Apakah `agentSessionID` adalah Session akar milik Session lokal. */
  isRoot(sessionId: string, agentSessionID: string): boolean;
  /** Petakan child sub-agent ke Session lokal induknya. */
  mapChild(childID: string, sessionId: string): void;
  /** Judul Session baru dari agent — kembalikan false bila tidak berubah. */
  setTitle(sessionId: string, title: string): void;
  /** Permission mode yang berlaku di agent berubah (Session akar). */
  setPermissionMode?(sessionId: string, mode: string): void;
  /** Simpan prompt baru; kembalikan false bila duplikat. */
  insertPrompt(prompt: InteractivePrompt): boolean;
  onPrompt?: (prompt: InteractivePrompt) => void;
  onError?: (sessionId: string, message: string) => void;
}

/** Teks dari konten hasil tool, dipotong bila terlalu panjang. */
export function toolContentText(content: readonly AgentToolContent[] | undefined): string {
  const text = (content ?? [])
    .map((c) => (typeof c.text === "string" ? c.text : c.type === "image" ? "[image]" : ""))
    .filter((s) => s !== "")
    .join("\n");
  return text.length > TOOL_OUTPUT_MAX_LENGTH
    ? `${text.slice(0, TOOL_OUTPUT_MAX_LENGTH)}\n… (truncated)`
    : text;
}

/** Part yang sedang dirakit untuk satu pesan assistant agent. */
interface MessageState {
  sessionId: string;
  parts: Map<string, MessagePart>;
  /** Part text/reasoning yang sudah dikirim (token pertama sudah tiba). */
  emitted: Set<string>;
}

export class AgentEventProjector {
  /** `${agentSessionID}:${messageID}` -> part yang sedang dirakit. */
  private readonly messages = new Map<string, MessageState>();
  /** id tool call -> nama tool (dari `session.tool.input.started`). */
  private readonly toolNames = new Map<string, string>();
  /** id tool call -> kunci pesan pemiliknya. */
  private readonly toolOwner = new Map<string, string>();
  /** Form yang menunggu jawaban (id form -> definisi) untuk menyusun jawaban. */
  private readonly forms = new Map<string, AgentForm>();
  /**
   * Session agent pemilik tiap prompt (id request/form -> sessionID agent).
   * Prompt sub-agent dimiliki child session, bukan Session akar — reply
   * harus ditujukan ke sana.
   */
  private readonly promptOwners = new Map<string, string>();

  constructor(private readonly opts: AgentProjectorOptions) {}

  /** Definisi form untuk prompt question (hilang setelah restart server). */
  form(formId: string): AgentForm | undefined {
    return this.forms.get(formId);
  }

  /** Session agent yang memunculkan prompt (undefined = tidak diketahui). */
  promptOwner(promptId: string): string | undefined {
    return this.promptOwners.get(promptId);
  }

  /** Lupakan prompt yang sudah dijawab/dibatalkan. */
  forgetPrompt(promptId: string): void {
    this.forms.delete(promptId);
    this.promptOwners.delete(promptId);
  }

  /** Buang state rakitan milik Session agent (turn ditutup). */
  private reset(agentSessionID: string): void {
    const prefix = `${agentSessionID}:`;
    for (const key of [...this.messages.keys()]) {
      if (!key.startsWith(prefix)) continue;
      this.messages.delete(key);
      for (const [toolId, owner] of this.toolOwner) {
        if (owner === key) {
          this.toolOwner.delete(toolId);
          this.toolNames.delete(toolId);
        }
      }
    }
  }

  private message(agentSessionID: string, messageID: string): MessageState | undefined {
    const sessionId = this.opts.resolve(agentSessionID);
    if (!sessionId) return undefined;
    const key = `${agentSessionID}:${messageID}`;
    let state = this.messages.get(key);
    if (!state) {
      state = { sessionId, parts: new Map(), emitted: new Set() };
      this.messages.set(key, state);
    }
    return state;
  }

  private put(state: MessageState, messageID: string, part: MessagePart): void {
    const id = part.id as string;
    state.parts.set(id, part);
    this.opts.turns.acceptPart(state.sessionId, messageID, { ...part, messageID });
  }

  private textStarted(
    data: AgentEventData<"session.text.started">,
    kind: "text" | "reasoning",
  ): void {
    const state = this.message(data.sessionID, data.assistantMessageID);
    if (!state) return;
    const id = `prt_${data.assistantMessageID}_${kind}_${data.ordinal}`;
    if (state.parts.has(id)) return;
    // Belum dikirim: menunggu token pertama.
    state.parts.set(id, { id, type: kind, text: "", time: { start: this.opts.now() } });
  }

  private textDelta(data: AgentEventData<"session.text.delta">, kind: "text" | "reasoning"): void {
    if (data.delta === "") return;
    const state = this.message(data.sessionID, data.assistantMessageID);
    if (!state) return;
    const id = `prt_${data.assistantMessageID}_${kind}_${data.ordinal}`;
    const part = state.parts.get(id) ?? {
      id,
      type: kind,
      text: "",
      time: { start: this.opts.now() },
    };
    if (!state.emitted.has(id)) {
      state.emitted.add(id);
      this.put(state, data.assistantMessageID, part);
    }
    state.parts.set(id, { ...part, text: `${part.text ?? ""}${data.delta}` });
    this.opts.turns.acceptDelta(state.sessionId, data.assistantMessageID, id, "text", data.delta);
  }

  private textEnded(data: AgentEventData<"session.text.ended">, kind: "text" | "reasoning"): void {
    const state = this.message(data.sessionID, data.assistantMessageID);
    if (!state) return;
    const id = `prt_${data.assistantMessageID}_${kind}_${data.ordinal}`;
    const prev = state.parts.get(id);
    // Tanpa token sama sekali (mis. reasoning tersembunyi) -> tidak ada part.
    if (data.text === "" && !state.emitted.has(id)) return;
    state.emitted.add(id);
    const start = prev?.time?.start ?? this.opts.now();
    this.put(state, data.assistantMessageID, {
      id,
      type: kind,
      text: data.text,
      time: { start, end: this.opts.now() },
    });
  }

  private toolPart(
    agentSessionID: string,
    messageID: string,
    toolId: string,
    state: Record<string, unknown>,
  ): void {
    const msg = this.message(agentSessionID, messageID);
    if (!msg) return;
    const id = `prt_${toolId}`;
    const prev = msg.parts.get(id);
    const prevState = (prev?.state ?? {}) as Record<string, unknown>;
    const time = (prevState.time ?? {}) as { start?: number };
    this.toolOwner.set(toolId, `${agentSessionID}:${messageID}`);
    this.put(msg, messageID, {
      id,
      type: "tool",
      tool: this.toolNames.get(toolId) ?? (prev?.tool as string | undefined) ?? "tool",
      callID: toolId,
      state: {
        ...prevState,
        ...state,
        time: { start: time.start ?? this.opts.now(), ...(state.time as object) },
      },
    });
  }

  /** Proses satu event agent. */
  handle(ev: AgentEvent): void {
    const turns = this.opts.turns;
    switch (ev.type) {
      case "session.created": {
        const { sessionID, parentID } = ev.data;
        if (!parentID || this.opts.resolve(sessionID)) return;
        const owner = this.opts.resolve(parentID);
        if (owner) this.opts.mapChild(sessionID, owner);
        return;
      }
      case "session.renamed": {
        const sessionId = this.opts.resolve(ev.data.sessionID);
        if (!sessionId || !this.opts.isRoot(sessionId, ev.data.sessionID)) return;
        const title = ev.data.title.trim();
        if (title === "" || isPlaceholderTitle(title)) return;
        this.opts.setTitle(sessionId, title);
        return;
      }
      case "session.step.started": {
        const sessionId = this.opts.resolve(ev.data.sessionID);
        if (sessionId) turns.noteAssistantMessage(sessionId, ev.data.assistantMessageID);
        return;
      }
      case "session.text.started":
        this.textStarted(ev.data, "text");
        return;
      case "session.text.delta":
        this.textDelta(ev.data, "text");
        return;
      case "session.text.ended":
        this.textEnded(ev.data, "text");
        return;
      case "session.reasoning.started":
        this.textStarted(ev.data, "reasoning");
        return;
      case "session.reasoning.delta":
        this.textDelta(ev.data, "reasoning");
        return;
      case "session.reasoning.ended":
        this.textEnded(ev.data, "reasoning");
        return;
      case "session.tool.input.started":
        this.toolNames.set(ev.data.id, ev.data.name);
        this.toolPart(ev.data.sessionID, ev.data.assistantMessageID, ev.data.id, {
          status: "pending",
          input: {},
        });
        return;
      case "session.tool.called":
        if (ev.data.name) this.toolNames.set(ev.data.id, ev.data.name);
        this.toolPart(ev.data.sessionID, ev.data.assistantMessageID, ev.data.id, {
          status: "running",
          input: ev.data.input,
        });
        return;
      case "session.tool.success":
        this.toolPart(ev.data.sessionID, ev.data.assistantMessageID, ev.data.id, {
          status: "completed",
          output: toolContentText(ev.data.content),
          ...(ev.data.metadata ? { metadata: ev.data.metadata } : {}),
          time: { end: this.opts.now() },
        });
        return;
      case "session.tool.failed": {
        const output = toolContentText(ev.data.content);
        this.toolPart(ev.data.sessionID, ev.data.assistantMessageID, ev.data.id, {
          status: "error",
          error: ev.data.error.message,
          ...(output ? { output } : {}),
          ...(ev.data.metadata ? { metadata: ev.data.metadata } : {}),
          time: { end: this.opts.now() },
        });
        return;
      }
      case "session.retry.scheduled": {
        const sessionId = this.opts.resolve(ev.data.sessionID);
        if (!sessionId) return;
        turns.keepAlive(sessionId);
        this.opts.onError?.(sessionId, retryMessage(ev.data.attempt, ev.data.error));
        return;
      }
      case "session.execution.succeeded":
      case "session.execution.failed":
      case "session.execution.interrupted": {
        const agentSessionID = ev.data.sessionID;
        const sessionId = this.opts.resolve(agentSessionID);
        if (!sessionId || !this.opts.isRoot(sessionId, agentSessionID)) return;
        this.reset(agentSessionID);
        if (ev.type === "session.execution.succeeded") {
          turns.finish(sessionId, "idle");
        } else if (ev.type === "session.execution.failed") {
          const message = describeAgentError(ev.data.error);
          if (turns.has(sessionId)) {
            // Tutup dengan error tertunda: pesan error hanya ditulis ke
            // history bila tidak ada konten setelahnya.
            turns.noteError(sessionId, message);
            turns.finish(sessionId, "idle");
          } else {
            this.opts.onError?.(sessionId, message);
          }
        } else {
          // Dibatalkan (interrupt user / shutdown): simpan parts tanpa banner.
          turns.finish(sessionId);
        }
        return;
      }
      case "permission.asked": {
        const sessionId = this.opts.resolve(ev.data.sessionID);
        if (!sessionId) return;
        // Menunggu keputusan user bukan sunyi: reset timer idle turn.
        turns.keepAlive(sessionId);
        this.promptOwners.set(ev.data.id, ev.data.sessionID);
        const prompt = promptFromPermission(ev.data, sessionId, this.opts.now());
        if (this.opts.insertPrompt(prompt)) this.opts.onPrompt?.(prompt);
        return;
      }
      case "form.created": {
        const form = ev.data.form;
        const sessionId = this.opts.resolve(form.sessionID);
        if (!sessionId) return;
        turns.keepAlive(sessionId);
        this.forms.set(form.id, form);
        this.promptOwners.set(form.id, form.sessionID);
        const prompt = promptFromForm(form, sessionId, this.opts.now());
        if (this.opts.insertPrompt(prompt)) this.opts.onPrompt?.(prompt);
        return;
      }
      case "form.replied":
      case "form.cancelled":
        this.forgetPrompt(ev.data.id);
        return;
      case "agent.permission_mode.changed": {
        const sessionId = this.opts.resolve(ev.data.sessionID);
        if (!sessionId || !this.opts.isRoot(sessionId, ev.data.sessionID)) return;
        this.opts.setPermissionMode?.(sessionId, ev.data.mode);
        return;
      }
      case "permission.replied":
        this.promptOwners.delete(ev.data.requestID);
        return;
      case "session.execution.started":
      case "session.step.ended":
      case "session.step.failed":
      case "session.tool.progress":
      case "agent.activity":
      case "agent.todos.updated": {
        // Tanda hidup: reset timer idle turn (tool lama, sub-agent, dst.).
        const sessionId = this.opts.resolve(ev.data.sessionID);
        if (sessionId) turns.keepAlive(sessionId);
        return;
      }
    }
  }
}
