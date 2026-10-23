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
 *
 * Kelas di sini hanya koordinator: tiap keluarga event ditangani modul di
 * `./projector/*` (part text/reasoning, part tool, sub-agent, pemakaian,
 * compact, prompt, siklus eksekusi) yang berbagi `ProjectorContext`.
 */
import type { AgentEvent, AgentForm } from "../agents/types";
import { compaction } from "./projector/compaction";
import { executionEnded, executionStarted } from "./projector/execution";
import { MessageStore } from "./projector/message-store";
import { PromptRegistry } from "./projector/prompts";
import { SubagentTracker } from "./projector/subagents";
import { textDelta, textEnded, textStarted } from "./projector/text-parts";
import { toolCalled, toolFailed, toolInputStarted, toolSucceeded } from "./projector/tool-parts";
import type { AgentProjectorOptions, ProjectorContext } from "./projector/types";
import { TurnUsageTracker } from "./projector/usage";
import { isPlaceholderTitle, retryMessage } from "./session-events";

export { toolContentText } from "./projector/tool-output";
export type { AgentProjectorOptions } from "./projector/types";

export class AgentEventProjector {
  private readonly ctx: ProjectorContext;
  private readonly prompts: PromptRegistry;

  constructor(private readonly opts: AgentProjectorOptions) {
    const messages = new MessageStore(opts);
    this.ctx = {
      opts,
      messages,
      subagents: new SubagentTracker(messages),
      usage: new TurnUsageTracker(messages),
    };
    this.prompts = new PromptRegistry(opts);
  }

  /** Definisi form untuk prompt question (hilang setelah restart server). */
  form(formId: string): AgentForm | undefined {
    return this.prompts.form(formId);
  }

  /** Session agent yang memunculkan prompt (undefined = tidak diketahui). */
  promptOwner(promptId: string): string | undefined {
    return this.prompts.owner(promptId);
  }

  /** Lupakan prompt yang sudah dijawab/dibatalkan. */
  forgetPrompt(promptId: string): void {
    this.prompts.forget(promptId);
  }

  /** Proses satu event agent. */
  handle(ev: AgentEvent): void {
    const ctx = this.ctx;
    const opts = this.opts;
    const turns = opts.turns;
    switch (ev.type) {
      case "session.created": {
        const { sessionID, parentID } = ev.data;
        if (!parentID) return;
        ctx.subagents.linkChild(sessionID, parentID);
        if (opts.resolve(sessionID)) return;
        const owner = opts.resolve(parentID);
        if (owner) opts.mapChild(sessionID, owner);
        return;
      }
      case "session.renamed": {
        const sessionId = opts.resolve(ev.data.sessionID);
        if (!sessionId || !opts.isRoot(sessionId, ev.data.sessionID)) return;
        const title = ev.data.title.trim();
        if (title === "" || isPlaceholderTitle(title)) return;
        opts.setTitle(sessionId, title);
        return;
      }
      case "session.step.started": {
        const sessionId = opts.resolve(ev.data.sessionID);
        if (!sessionId) return;
        ctx.messages.lastMessages.set(ev.data.sessionID, ev.data.assistantMessageID);
        turns.noteAssistantMessage(sessionId, ev.data.assistantMessageID);
        return;
      }
      case "agent.compaction":
        compaction(ctx, ev.data);
        return;
      case "agent.subagent": {
        const { sessionID, assistantMessageID, toolID, ...patch } = ev.data;
        const sessionId = opts.resolve(sessionID);
        if (!sessionId) return;
        turns.keepAlive(sessionId);
        ctx.subagents.put(sessionID, assistantMessageID, toolID, patch);
        return;
      }
      case "session.step.ended": {
        const sessionId = opts.resolve(ev.data.sessionID);
        if (!sessionId) return;
        turns.keepAlive(sessionId);
        const { tokens, cost } = ev.data;
        if (!tokens) return;
        ctx.usage.add(sessionId, cost, tokens);
        ctx.subagents.addStepTokens(ev.data.sessionID, ev.data.assistantMessageID, tokens);
        return;
      }
      case "session.text.started":
        textStarted(ctx, ev.data, "text");
        return;
      case "session.text.delta":
        textDelta(ctx, ev.data, "text");
        return;
      case "session.text.ended":
        textEnded(ctx, ev.data, "text");
        return;
      case "session.reasoning.started":
        textStarted(ctx, ev.data, "reasoning");
        return;
      case "session.reasoning.delta":
        textDelta(ctx, ev.data, "reasoning");
        return;
      case "session.reasoning.ended":
        textEnded(ctx, ev.data, "reasoning");
        return;
      case "session.tool.input.started":
        toolInputStarted(ctx, ev.data);
        return;
      case "session.tool.called":
        toolCalled(ctx, ev.data);
        return;
      case "session.tool.success":
        toolSucceeded(ctx, ev.data);
        return;
      case "session.tool.failed":
        toolFailed(ctx, ev.data);
        return;
      case "session.retry.scheduled": {
        const sessionId = opts.resolve(ev.data.sessionID);
        if (!sessionId) return;
        turns.keepAlive(sessionId);
        opts.onError?.(sessionId, retryMessage(ev.data.attempt, ev.data.error));
        return;
      }
      case "session.execution.succeeded":
      case "session.execution.failed":
      case "session.execution.interrupted":
        executionEnded(ctx, ev);
        return;
      case "permission.asked":
        this.prompts.permissionAsked(ev.data);
        return;
      case "form.created":
        this.prompts.formCreated(ev.data);
        return;
      case "form.replied":
      case "form.cancelled":
        this.forgetPrompt(ev.data.id);
        return;
      case "agent.permission_mode.changed": {
        const sessionId = opts.resolve(ev.data.sessionID);
        if (!sessionId || !opts.isRoot(sessionId, ev.data.sessionID)) return;
        opts.setPermissionMode?.(sessionId, ev.data.mode);
        return;
      }
      case "permission.replied":
        this.prompts.permissionReplied(ev.data.requestID);
        return;
      case "session.execution.started":
        executionStarted(ctx, ev.data);
        return;
      case "session.step.failed":
      case "session.tool.progress":
      case "agent.activity":
      case "agent.todos.updated": {
        // Tanda hidup: reset timer idle turn (tool lama, sub-agent, dst.).
        const sessionId = opts.resolve(ev.data.sessionID);
        if (sessionId) turns.keepAlive(sessionId);
        return;
      }
    }
  }
}
