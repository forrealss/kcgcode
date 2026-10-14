/**
 * Pesan SDK dari stream proses `claude` -> `AgentEvent` + state Session.
 *
 * Pesan `system` (init, status, compact, task sub-agent, perubahan state),
 * error API, dan `result` ditangani di sini; sisanya (teks, tool call)
 * diteruskan ke `ClaudeTurnTranslator`.
 */
import type { SDKMessage, SlashCommand } from "@anthropic-ai/claude-agent-sdk";
import type { AgentError, AgentEvent, AgentSubagentStatus } from "../types";
import type { ClaudeCatalog } from "./catalog";
import { type LiveSession, settleInterrupt } from "./live-session";
import { turnUsageFrom, usageTotals, ZERO_USAGE } from "./usage";

/** Status task CLI -> status sub-agent. */
function subagentStatus(status: unknown): AgentSubagentStatus | undefined {
  switch (status) {
    case "running":
    case "pending":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "stopped":
    case "killed":
      return "stopped";
    default:
      return undefined;
  }
}

export interface MessageHandlerDeps {
  emit: (ev: AgentEvent) => void;
  catalog: Pick<ClaudeCatalog, "noteInitMcp" | "noteCommands">;
  cancelIdleClose: (live: LiveSession) => void;
  scheduleIdleClose: (live: LiveSession) => void;
  refreshUsage: (live: LiveSession) => Promise<void>;
}

export interface MessageHandler {
  handleMessage(live: LiveSession, msg: SDKMessage): void;
  /** Turn selesai: succeeded / failed (error tertunda) / interrupted. */
  emitIdle(live: LiveSession): void;
}

export function createMessageHandler(deps: MessageHandlerDeps): MessageHandler {
  const { emit, catalog } = deps;

  /** Pancarkan perubahan compact; `ended`/`failed` menutup status compacting. */
  function emitCompaction(
    live: LiveSession,
    phase: "started" | "ended" | "failed",
    extra: { preTokens?: number; postTokens?: number; error?: AgentError } = {},
  ): void {
    const trigger = live.compacting ?? "auto";
    if (phase !== "started") {
      live.compacting = null;
      live.manualCompact = false;
    }
    const assistantMessageID = live.translator.currentMessageId;
    emit({
      type: "agent.compaction",
      data: {
        sessionID: live.id,
        phase,
        trigger,
        ...(assistantMessageID ? { assistantMessageID } : {}),
        ...extra,
      },
    });
  }

  function emitIdle(live: LiveSession): void {
    live.running = false;
    // Compact yang tidak sempat selesai (interrupt / proses berhenti) ditutup
    // tanpa penanda "compacted".
    if (live.compacting !== null) {
      emitCompaction(live, "failed", {
        error: { type: "aborted", message: "Compaction was interrupted." },
      });
    }
    live.manualCompact = false;
    const sessionID = live.id;
    const error = live.turnError;
    live.turnError = null;
    if (live.skipNextIdle) {
      // Idle milik turn yang di-interrupt.
      settleInterrupt(live);
      emit({ type: "session.execution.interrupted", data: { sessionID, reason: "user" } });
      return;
    }
    if (error) emit({ type: "session.execution.failed", data: { sessionID, error } });
    else emit({ type: "session.execution.succeeded", data: { sessionID } });
    live.translator.endTurn();
  }

  /**
   * Pesan `task_*` CLI untuk task sub-agent (`local_agent`) ->
   * `agent.subagent`. Task lain (shell latar belakang, monitor) hanya dicatat
   * agar proses tidak ditutup saat masih berjalan.
   */
  function handleTask(live: LiveSession, m: Record<string, unknown>): void {
    const taskId = typeof m.task_id === "string" ? m.task_id : null;
    if (!taskId) return;
    const usage = (m.usage ?? {}) as Record<string, unknown>;
    const stats = {
      ...(typeof usage.total_tokens === "number" ? { tokens: usage.total_tokens } : {}),
      ...(typeof usage.tool_uses === "number" ? { toolUses: usage.tool_uses } : {}),
      ...(typeof usage.duration_ms === "number" ? { durationMs: usage.duration_ms } : {}),
    };
    if (m.subtype === "task_started") {
      if (m.is_backgrounded === true) live.backgroundTasks.add(taskId);
      const isAgent = m.task_type === "local_agent" || typeof m.subagent_type === "string";
      if (!isAgent || typeof m.tool_use_id !== "string") return;
      live.taskTools.set(taskId, m.tool_use_id);
      live.translator.subagent({
        toolID: m.tool_use_id,
        status: "running",
        ...(typeof m.subagent_type === "string" ? { agentType: m.subagent_type } : {}),
        ...(typeof m.description === "string" ? { description: m.description } : {}),
        background: m.is_backgrounded === true,
      });
      return;
    }
    const toolID = live.taskTools.get(taskId);
    const patch = (m.patch ?? {}) as Record<string, unknown>;
    const status = subagentStatus(m.subtype === "task_updated" ? patch.status : m.status);
    const ended = status !== undefined && status !== "running";
    if (ended) live.backgroundTasks.delete(taskId);
    if (toolID) {
      if (m.subtype === "task_progress") {
        live.translator.subagent({
          toolID,
          ...stats,
          ...(typeof m.last_tool_name === "string" ? { lastTool: m.last_tool_name } : {}),
        });
      } else if (m.subtype === "task_updated" && status) {
        live.translator.subagent({ toolID, status });
      } else if (m.subtype === "task_notification") {
        live.translator.subagent({
          toolID,
          ...(status ? { status } : {}),
          ...stats,
          ...(typeof m.summary === "string" && m.summary.trim() !== ""
            ? { summary: m.summary }
            : {}),
        });
      }
    }
    // Sub-agent latar belakang yang membuka turn saat agent utama idle:
    // tutup turn begitu semua task selesai (CLI membuka turn baru sendiri
    // bila agent utama dibangunkan oleh hasilnya).
    if (ended && !live.running && live.backgroundTasks.size === 0) {
      if (live.translator.currentMessageId !== null) {
        emit({ type: "session.execution.succeeded", data: { sessionID: live.id } });
        live.translator.endTurn();
      }
    }
  }

  /**
   * Catat error turn. Turn yang berjalan ditutup `failed` saat idle (konten
   * yang menyusul error tetap tersimpan); tanpa turn, error langsung dilaporkan.
   */
  function noteError(live: LiveSession, message: string, type = "unknown"): void {
    const error: AgentError = { type, message };
    if (live.running || live.sawState === false) {
      live.turnError ??= error;
      return;
    }
    emit({ type: "session.execution.failed", data: { sessionID: live.id, error } });
  }

  /** Catat mode yang dilaporkan CLI; pancarkan perubahan saja. */
  function reportMode(live: LiveSession, mode: string): void {
    if (live.reportedMode === mode) return;
    live.reportedMode = mode;
    // Proses kini berjalan dengan mode ini — pilihan berikutnya dibandingkan
    // terhadapnya (hindari `setPermissionMode` ulang yang tidak perlu).
    live.mode = mode;
    live.wantMode = mode;
    emit({ type: "agent.permission_mode.changed", data: { sessionID: live.id, mode } });
  }

  /**
   * Pesan `type: system`. `true` = sudah ditangani penuh; `false` = tetap
   * diteruskan ke translator (mis. `status`, subtype yang tidak dikenal).
   */
  function handleSystem(live: LiveSession, m: Record<string, unknown>): boolean {
    // Mode yang BERLAKU dilaporkan CLI di `init` (awal tiap turn) dan
    // `status` (mis. setelah rencana disetujui atau mode diganti) —
    // diteruskan agar pilihan di UI selalu mengikuti keadaan sebenarnya.
    if ((m.subtype === "init" || m.subtype === "status") && typeof m.permissionMode === "string") {
      reportMode(live, m.permissionMode);
    }
    switch (m.subtype) {
      case "init":
        live.persisted = true;
        catalog.noteInitMcp(Array.isArray(m.mcp_servers) ? m.mcp_servers : []);
        return true;
      case "status":
        if (m.status === "compacting" && live.compacting === null) {
          live.compacting = live.manualCompact ? "manual" : "auto";
          emitCompaction(live, "started");
        } else if (m.compact_result === "failed" && live.compacting !== null) {
          const message =
            typeof m.compact_error === "string" && m.compact_error.trim() !== ""
              ? m.compact_error
              : "Claude Code could not compact the conversation.";
          emitCompaction(live, "failed", { error: { type: "compaction.failed", message } });
        }
        // `compact_result: success` -> penanda dikirim saat `compact_boundary`.
        return false;
      case "compact_boundary": {
        const meta = (m.compact_metadata ?? {}) as Record<string, unknown>;
        live.compacting ??= meta.trigger === "manual" ? "manual" : "auto";
        emitCompaction(live, "ended", {
          ...(typeof meta.pre_tokens === "number" ? { preTokens: meta.pre_tokens } : {}),
          ...(typeof meta.post_tokens === "number" ? { postTokens: meta.post_tokens } : {}),
        });
        return true;
      }
      case "commands_changed":
        if (!Array.isArray(m.commands)) return false;
        catalog.noteCommands(m.commands as SlashCommand[]);
        return true;
      case "session_state_changed":
        live.sawState = true;
        if (m.state === "running") {
          live.running = true;
          deps.cancelIdleClose(live);
        } else if (m.state === "idle") {
          emitIdle(live);
          deps.scheduleIdleClose(live);
          void deps.refreshUsage(live);
        }
        return true;
      default:
        if (typeof m.subtype === "string" && m.subtype.startsWith("task_")) {
          handleTask(live, m);
          return true;
        }
        return false;
    }
  }

  /**
   * Error API (auth, rate limit, model tidak ada) dilaporkan CLI sebagai
   * pesan assistant sintetis — tampilkan sebagai error, bukan jawaban.
   */
  function handleAssistantError(live: LiveSession, m: Record<string, unknown>, error: string) {
    const content = (m.message as { content?: unknown } | undefined)?.content;
    const text = Array.isArray(content)
      ? content
          .map((b) => (b as { text?: unknown })?.text)
          .filter((t): t is string => typeof t === "string")
          .join("\n")
      : "";
    const kind = error === "authentication_failed" ? "provider.auth" : `provider.${error}`;
    noteError(live, text.trim() || `Claude Code error: ${error.replace(/_/g, " ")}`, kind);
  }

  /** Pesan `result`: pemakaian turn, error turn, dan fallback akhir turn. */
  function handleResult(live: LiveSession, m: Record<string, unknown>): void {
    // Pemakaian turn (token & biaya) -> `session.step.ended` pesan turn.
    const assistantMessageID = live.translator.currentMessageId;
    const usage = turnUsageFrom(m, live.usageBaseUnknown ? null : (live.usageBase ?? ZERO_USAGE));
    live.usageBase = usageTotals(m);
    live.usageBaseUnknown = false;
    if (assistantMessageID) {
      emit({
        type: "session.step.ended",
        data: { sessionID: live.id, assistantMessageID, finish: "stop", ...usage },
      });
    }
    // Turn yang di-interrupt: hasilnya (biasanya error_during_execution)
    // bukan kegagalan yang perlu banner.
    if (!live.skipNextIdle && (m.subtype !== "success" || m.is_error === true)) {
      const errors = Array.isArray(m.errors) ? m.errors.filter((e) => typeof e === "string") : [];
      const message =
        errors.join("\n") ||
        (typeof m.result === "string" && m.result) ||
        `Claude Code stopped: ${String(m.subtype).replace(/_/g, " ")}`;
      live.turnError ??= { type: String(m.subtype), message };
    }
    // CLI lama tanpa `session_state_changed`: `result` menutup turn.
    if (!live.sawState) {
      emitIdle(live);
      deps.scheduleIdleClose(live);
    }
  }

  function handleMessage(live: LiveSession, msg: SDKMessage): void {
    const m = msg as unknown as Record<string, unknown>;
    // Tanda hidup apa pun -> reset timer idle turn (tool lama, retry, dll).
    if (live.running) emit({ type: "agent.activity", data: { sessionID: live.id } });

    if (m.type === "system" && handleSystem(live, m)) return;
    if (m.type === "assistant" && typeof m.error === "string") {
      handleAssistantError(live, m, m.error);
      return;
    }
    if (m.type === "result") {
      handleResult(live, m);
      return;
    }

    const effects = live.translator.handle(m);
    if (effects.todos) {
      live.todos = effects.todos;
      emit({ type: "agent.todos.updated", data: { sessionID: live.id, todos: effects.todos } });
    }
  }

  return { handleMessage, emitIdle };
}
