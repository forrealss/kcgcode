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
 * - sub-agent: part kontennya membawa `parentToolID` (id tool call `task` /
 *   `Agent`) — dari event (Claude) atau dari tautan Session anak opencode ke
 *   tool call `task` yang membuatnya. Status/statistiknya (`agent.subagent`,
 *   token step Session anak) -> part `subagent` (`prt_<msg>_subagent_<tool>`)
 *   di pesan turn berjalan; yang terbaru berlaku.
 * - pemakaian turn: `session.step.ended` (cost/tokens) Session akar & anak
 *   dijumlahkan -> part `usage` di pesan terakhir saat turn berakhir.
 * - turn yang dimulai agent sendiri (tanpa prompt dari bridge) dibuka lewat
 *   `beginTurn` saat `session.execution.started` Session akar.
 * - compact (`agent.compaction`) -> status "compacting" Session lokal; saat
 *   selesai, part `compaction` (penanda "conversation compacted" beserta
 *   ukuran konteks sebelum/sesudah) di pesan turn yang sedang berjalan.
 *
 * Akhir turn hanya dari Session AKAR: sub-agent (child session) selesai lebih
 * dulu dari induknya.
 */
import type { InteractivePrompt, MessagePart } from "../../types";
import type {
  AgentEvent,
  AgentEventData,
  AgentForm,
  AgentTokenUsage,
  AgentToolContent,
} from "../agents/types";
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
  /** Agent mulai / selesai meringkas riwayat Session (compact). */
  setCompacting?(sessionId: string, compacting: boolean): void;
  /** Buka turn untuk eksekusi yang dimulai agent sendiri (tanpa prompt bridge). */
  beginTurn?(sessionId: string): void;
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
  /** Pesan assistant terakhir per Session agent (tempat penanda compact). */
  private readonly lastMessages = new Map<string, string>();
  /** Session anak opencode -> tool call `task` yang membuatnya. */
  private readonly childTools = new Map<string, string>();
  /** Tool call `task` per Session agent yang belum punya Session anak (FIFO). */
  private readonly pendingTasks = new Map<string, string[]>();
  /** Info sub-agent terakumulasi per tool call (status, token, …). */
  private readonly subagents = new Map<string, Record<string, unknown>>();
  /** Pemakaian turn berjalan per Session lokal (akar + anak). */
  private readonly turnUsage = new Map<
    string,
    {
      cost: number | null;
      input: number;
      output: number;
      reasoning: number;
      read: number;
      write: number;
    }
  >();

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
    this.lastMessages.delete(agentSessionID);
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

  /** `parentToolID` konten: dari event, atau tautan Session anak (opencode). */
  private parentField(agentSessionID: string, explicit?: string): { parentToolID?: string } {
    const parent = explicit ?? this.childTools.get(agentSessionID);
    return parent ? { parentToolID: parent } : {};
  }

  /**
   * Gabungkan info sub-agent lalu tulis part `subagent` (info lengkap) ke
   * pesan turn berjalan — satu part per tool call per pesan.
   */
  private putSubagent(
    agentSessionID: string,
    messageID: string | undefined,
    toolID: string,
    patch: Record<string, unknown>,
  ): void {
    const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const info = { ...(this.subagents.get(toolID) ?? {}), ...defined };
    this.subagents.set(toolID, info);
    const msgId = messageID ?? this.lastMessages.get(agentSessionID);
    if (!msgId) return;
    const state = this.message(agentSessionID, msgId);
    if (!state) return;
    this.put(state, msgId, {
      ...info,
      id: `prt_${msgId}_subagent_${toolID}`,
      type: "subagent",
      toolID,
    });
  }

  /** Tambahkan pemakaian satu step ke turn berjalan Session lokal. */
  private addUsage(sessionId: string, cost: number | undefined, tokens: AgentTokenUsage): void {
    const cur = this.turnUsage.get(sessionId) ?? {
      cost: null,
      input: 0,
      output: 0,
      reasoning: 0,
      read: 0,
      write: 0,
    };
    if (typeof cost === "number") cur.cost = (cur.cost ?? 0) + cost;
    cur.input += tokens.input;
    cur.output += tokens.output;
    cur.reasoning += tokens.reasoning;
    cur.read += tokens.cache.read;
    cur.write += tokens.cache.write;
    this.turnUsage.set(sessionId, cur);
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
    state.parts.set(id, {
      id,
      type: kind,
      text: "",
      time: { start: this.opts.now() },
      ...this.parentField(data.sessionID, data.parentToolID),
    });
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
      ...this.parentField(data.sessionID, data.parentToolID),
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
      ...this.parentField(data.sessionID, data.parentToolID ?? (prev?.parentToolID as string)),
    });
  }

  private toolPart(
    agentSessionID: string,
    messageID: string,
    toolId: string,
    state: Record<string, unknown>,
    parentToolID?: string,
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
      ...this.parentField(agentSessionID, parentToolID ?? (prev?.parentToolID as string)),
      state: {
        ...prevState,
        ...state,
        time: { start: time.start ?? this.opts.now(), ...(state.time as object) },
      },
    });
  }

  /**
   * Compact Session akar: status compacting, penanda di timeline saat selesai,
   * atau banner bila gagal (kecuali dibatalkan user).
   */
  private compaction(data: AgentEventData<"agent.compaction">): void {
    const agentSessionID = data.sessionID;
    const sessionId = this.opts.resolve(agentSessionID);
    if (!sessionId || !this.opts.isRoot(sessionId, agentSessionID)) return;
    const turns = this.opts.turns;
    turns.keepAlive(sessionId);
    this.opts.setCompacting?.(sessionId, data.phase === "started");
    if (data.phase === "failed") {
      if (data.error?.type !== "aborted") {
        this.opts.onError?.(
          sessionId,
          `Couldn't compact the conversation: ${data.error?.message ?? "unknown error"}`,
        );
      }
      return;
    }
    if (data.phase !== "ended") return;
    // Penanda ditempel ke pesan turn berjalan; tanpa pesan (compact sebagai
    // satu-satunya isi turn di opencode) dibuat pesan assistant tersendiri.
    let messageID = data.assistantMessageID ?? this.lastMessages.get(agentSessionID);
    if (!messageID) {
      messageID = `msg_compaction_${agentSessionID}_${this.opts.now()}`;
      this.lastMessages.set(agentSessionID, messageID);
      turns.noteAssistantMessage(sessionId, messageID);
    }
    const state = this.message(agentSessionID, messageID);
    if (!state) return;
    const n = [...state.parts.values()].filter((p) => p.type === "compaction").length;
    this.put(state, messageID, {
      id: `prt_${messageID}_compaction_${n}`,
      type: "compaction",
      trigger: data.trigger,
      ...(data.preTokens !== undefined ? { preTokens: data.preTokens } : {}),
      ...(data.postTokens !== undefined ? { postTokens: data.postTokens } : {}),
      time: { created: this.opts.now() },
    });
  }

  /** Tulis part `usage` turn (bila ada pemakaian) ke pesan terakhir turn. */
  private flushUsage(sessionId: string, agentSessionID: string): void {
    const usage = this.turnUsage.get(sessionId);
    this.turnUsage.delete(sessionId);
    const msgId = this.lastMessages.get(agentSessionID);
    if (!usage || !msgId) return;
    const state = this.message(agentSessionID, msgId);
    if (!state) return;
    this.put(state, msgId, {
      id: `prt_${msgId}_usage`,
      type: "usage",
      ...(usage.cost !== null ? { cost: usage.cost } : {}),
      tokens: {
        input: usage.input,
        output: usage.output,
        reasoning: usage.reasoning,
        cache: { read: usage.read, write: usage.write },
      },
    });
  }

  /** Proses satu event agent. */
  handle(ev: AgentEvent): void {
    const turns = this.opts.turns;
    switch (ev.type) {
      case "session.created": {
        const { sessionID, parentID } = ev.data;
        if (!parentID) return;
        // Sub-agent opencode: Session anak milik tool call `task` induk yang
        // belum punya anak (urutan pemanggilan = urutan pembuatan).
        if (!this.childTools.has(sessionID)) {
          const toolID = this.pendingTasks.get(parentID)?.shift();
          if (toolID) this.childTools.set(sessionID, toolID);
        }
        if (this.opts.resolve(sessionID)) return;
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
        if (!sessionId) return;
        this.lastMessages.set(ev.data.sessionID, ev.data.assistantMessageID);
        turns.noteAssistantMessage(sessionId, ev.data.assistantMessageID);
        return;
      }
      case "agent.compaction":
        this.compaction(ev.data);
        return;
      case "agent.subagent": {
        const { sessionID, assistantMessageID, toolID, ...patch } = ev.data;
        const sessionId = this.opts.resolve(sessionID);
        if (!sessionId) return;
        turns.keepAlive(sessionId);
        this.putSubagent(sessionID, assistantMessageID, toolID, patch);
        return;
      }
      case "session.step.ended": {
        const sessionId = this.opts.resolve(ev.data.sessionID);
        if (!sessionId) return;
        turns.keepAlive(sessionId);
        const { tokens, cost } = ev.data;
        if (!tokens) return;
        this.addUsage(sessionId, cost, tokens);
        // Step Session anak opencode = kerja sub-agent: token ke kartunya.
        const toolID = this.childTools.get(ev.data.sessionID);
        if (toolID) {
          const prev = this.subagents.get(toolID)?.tokens;
          const used =
            tokens.input +
            tokens.output +
            tokens.reasoning +
            tokens.cache.read +
            tokens.cache.write;
          this.putSubagent(ev.data.sessionID, ev.data.assistantMessageID, toolID, {
            tokens: (typeof prev === "number" ? prev : 0) + used,
          });
        }
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
        this.toolPart(
          ev.data.sessionID,
          ev.data.assistantMessageID,
          ev.data.id,
          { status: "pending", input: {} },
          ev.data.parentToolID,
        );
        return;
      case "session.tool.called": {
        if (ev.data.name) this.toolNames.set(ev.data.id, ev.data.name);
        this.toolPart(
          ev.data.sessionID,
          ev.data.assistantMessageID,
          ev.data.id,
          { status: "running", input: ev.data.input },
          ev.data.parentToolID,
        );
        // Tool `task` opencode akan membuat Session anak — tautkan saat dibuat.
        if (this.toolNames.get(ev.data.id) === "task") {
          const queue = this.pendingTasks.get(ev.data.sessionID) ?? [];
          if (!queue.includes(ev.data.id)) queue.push(ev.data.id);
          this.pendingTasks.set(ev.data.sessionID, queue);
        }
        return;
      }
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
        this.flushUsage(sessionId, agentSessionID);
        this.reset(agentSessionID);
        // Compact tidak mungkin berlanjut setelah eksekusi berakhir.
        this.opts.setCompacting?.(sessionId, false);
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
      case "session.execution.started": {
        const sessionId = this.opts.resolve(ev.data.sessionID);
        if (!sessionId) return;
        // Eksekusi tanpa prompt dari bridge (mis. agent dibangunkan hasil
        // sub-agent latar belakang): buka turn agar kontennya tersimpan.
        if (this.opts.isRoot(sessionId, ev.data.sessionID)) {
          // Pemakaian dihitung per eksekusi Session akar.
          this.turnUsage.delete(sessionId);
          if (!turns.has(sessionId)) this.opts.beginTurn?.(sessionId);
        }
        turns.keepAlive(sessionId);
        return;
      }
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
