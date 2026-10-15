/**
 * Siklus hidup proses `claude` per Session: spawn/resume (`startQuery`),
 * pembacaan stream (`pump`), sinkron model/effort/mode ke proses yang hidup,
 * idle close, penutupan sengaja, dan pengukuran pemakaian context window.
 *
 * Pesan dari stream diteruskan ke `MessageHandler` (`messages.ts`), yang
 * balik memakai timer idle & pengukuran usage modul ini.
 */
import type { Options, PermissionMode, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent } from "../types";
import type { PendingAsks } from "./asks";
import type { ClaudeCatalog } from "./catalog";
import { CONTROL_TIMEOUT_MS, STDERR_TAIL_LINES } from "./constants";
import { type LiveSession, settleInterrupt, stderrTail } from "./live-session";
import { createMessageHandler } from "./messages";
import {
  type ClaudeQueryFn,
  type ClaudeQueryLike,
  type ClaudeTranscripts,
  InputQueue,
  withTimeout,
} from "./sdk";
import { contextUsageFrom } from "./usage";

export interface ClaudeProcessesDeps {
  cwd: string;
  runQuery: ClaudeQueryFn;
  transcripts: ClaudeTranscripts;
  emit: (ev: AgentEvent) => void;
  catalog: ClaudeCatalog;
  asks: PendingAsks;
  /** Opsi dasar proses `claude` (cwd, settings, env, executable). */
  sharedOptions: () => Options;
  idleCloseMs: number;
  now: () => number;
  setTimeoutFn: (cb: () => void, ms: number) => unknown;
  clearTimeoutFn: (handle: unknown) => void;
}

export interface ClaudeProcesses {
  cancelIdleClose(live: LiveSession): void;
  scheduleIdleClose(live: LiveSession): void;
  /** Tutup proses `claude` Session (sengaja — bukan crash). */
  closeQuery(live: LiveSession): void;
  /** Ukur ulang pemakaian context window dari proses yang hidup. */
  refreshUsage(live: LiveSession): Promise<void>;
  /** Spawn proses `claude` untuk Session (resume bila transcript sudah ada). */
  startQuery(live: LiveSession): Promise<void>;
  /** Terapkan pilihan model/effort/mode yang berubah ke proses yang hidup. */
  syncLiveSettings(live: LiveSession, q: ClaudeQueryLike): Promise<void>;
}

export function createClaudeProcesses(deps: ClaudeProcessesDeps): ClaudeProcesses {
  const {
    cwd,
    runQuery,
    transcripts,
    emit,
    catalog,
    asks,
    sharedOptions,
    idleCloseMs,
    now,
    setTimeoutFn,
    clearTimeoutFn,
  } = deps;

  const messages = createMessageHandler({
    emit,
    catalog,
    cancelIdleClose,
    scheduleIdleClose,
    refreshUsage,
  });

  function cancelIdleClose(live: LiveSession): void {
    if (live.idleTimer !== undefined) {
      clearTimeoutFn(live.idleTimer);
      live.idleTimer = undefined;
    }
  }

  function scheduleIdleClose(live: LiveSession): void {
    cancelIdleClose(live);
    live.idleTimer = setTimeoutFn(() => {
      live.idleTimer = undefined;
      if (live.running) return;
      // Sub-agent / task latar belakang masih bekerja: menutup proses akan
      // membunuhnya — tunggu satu jendela idle lagi.
      if (live.backgroundTasks.size > 0) scheduleIdleClose(live);
      else closeQuery(live);
    }, idleCloseMs);
  }

  /** Tutup proses `claude` Session (sengaja — bukan crash). */
  function closeQuery(live: LiveSession): void {
    cancelIdleClose(live);
    if (!live.query) return;
    live.closing = true;
    live.input?.close();
    try {
      live.query.close();
    } catch {
      // Proses sudah mati.
    }
    live.query = null;
    live.input = null;
    live.running = false;
    settleInterrupt(live);
  }

  /**
   * Ukur ulang pemakaian context window dari proses yang hidup (`summary`:
   * dari usage respons terakhir + estimasi lokal, tanpa request hitung
   * token). Gagal -> pakai angka terakhir.
   */
  function refreshUsage(live: LiveSession): Promise<void> {
    const q = live.query;
    if (!q) return Promise.resolve();
    live.usageInFlight ??= withTimeout(
      q.getContextUsage({ detail: "summary" }),
      CONTROL_TIMEOUT_MS,
      "getContextUsage",
    )
      .then((res) => {
        live.usage = contextUsageFrom(res, now());
      })
      .catch(() => {})
      .finally(() => {
        live.usageInFlight = null;
      });
    return live.usageInFlight;
  }

  /** Baca stream proses sampai selesai; crash dilaporkan sebagai error turn. */
  async function pump(live: LiveSession, q: ClaudeQueryLike): Promise<void> {
    try {
      for await (const msg of q) {
        if (live.query !== q) break;
        messages.handleMessage(live, msg);
      }
    } catch (e) {
      if (live.query === q && !live.closing) {
        const tail = stderrTail(live);
        const detail = (e as Error).message ?? String(e);
        live.turnError ??= {
          type: "process.exited",
          message: `Claude Code exited unexpectedly: ${detail}${tail ? `\n${tail}` : ""}`,
        };
      }
    } finally {
      if (live.query === q) {
        const wasRunning = live.running;
        // Stream berakhir di tengah turn tanpa ditutup sengaja = turn terputus.
        if (wasRunning && !live.closing && !live.skipNextIdle) {
          const tail = stderrTail(live);
          live.turnError ??= {
            type: "process.exited",
            message: `Claude Code exited unexpectedly.${tail ? `\n${tail}` : ""}`,
          };
        }
        live.query = null;
        live.input?.close();
        live.input = null;
        asks.dropSession(live.id, "Claude Code process ended.");
        if ((wasRunning || live.turnError) && !live.closing) messages.emitIdle(live);
        live.running = false;
        settleInterrupt(live);
      }
      live.closing = false;
    }
  }

  /** Opsi `query()` untuk proses baru Session dengan pilihan `want*`. */
  function queryOptions(live: LiveSession): Options {
    const { wantModel: model, wantEffort: effort, wantMode: mode, wantSystem: system } = live;
    return {
      ...sharedOptions(),
      includePartialMessages: true,
      ...(live.persisted ? { resume: live.id } : { sessionId: live.id }),
      ...(model ? { model } : {}),
      // Tanpa effort eksplisit: ikuti `effortLevel` settings user / default model.
      ...(effort ? { effort } : {}),
      // Tanpa mode eksplisit: ikuti `permissions.defaultMode` user.
      ...(mode ? { permissionMode: mode as PermissionMode } : {}),
      // Hanya MENGIZINKAN pindah ke `bypassPermissions` (dipilih user secara
      // eksplisit lewat konfirmasi di UI) — tidak mengaktifkannya.
      allowDangerouslySkipPermissions: true,
      ...(system
        ? {
            systemPrompt: {
              type: "preset" as const,
              preset: "claude_code" as const,
              append: system,
            },
          }
        : {}),
      canUseTool: (toolName, toolInput, o) => asks.canUseTool(live.id, toolName, toolInput, o),
      stderr: (data) => {
        live.stderr.push(...data.split("\n").filter((l) => l.trim() !== ""));
        if (live.stderr.length > STDERR_TAIL_LINES)
          live.stderr.splice(0, live.stderr.length - STDERR_TAIL_LINES);
      },
    };
  }

  /** Spawn proses `claude` untuk Session (resume bila transcript sudah ada). */
  async function startQuery(live: LiveSession): Promise<void> {
    if (!live.persisted) live.persisted = await transcripts.exists(live.id, cwd);
    const input = new InputQueue<SDKUserMessage>();
    const q = runQuery({ prompt: input, options: queryOptions(live) });
    // Resume dengan total kumulatif yang belum diketahui (mis. setelah server
    // KCG restart): turn pertama tidak bisa dihitung selisihnya.
    live.usageBaseUnknown = live.persisted && live.usageBase === null;
    live.query = q;
    live.input = input;
    live.model = live.wantModel;
    live.effort = live.wantEffort;
    live.mode = live.wantMode;
    live.system = live.wantSystem;
    live.closing = false;
    live.sawState = false;
    live.stderr = [];
    live.pumpDone = pump(live, q);
  }

  /** Terapkan pilihan model/effort/mode yang berubah ke proses yang hidup. */
  async function syncLiveSettings(live: LiveSession, q: ClaudeQueryLike): Promise<void> {
    if (live.wantModel !== live.model) {
      await withTimeout(q.setModel(live.wantModel ?? undefined), CONTROL_TIMEOUT_MS, "setModel");
      live.model = live.wantModel;
    }
    // Setelah model: effort di-clamp CLI ke tingkat yang didukung model.
    if (live.wantEffort !== live.effort) {
      await withTimeout(
        q.applyFlagSettings({ effortLevel: live.wantEffort }),
        CONTROL_TIMEOUT_MS,
        "applyFlagSettings",
      );
      live.effort = live.wantEffort;
    }
    if (live.wantMode !== live.mode) {
      await withTimeout(
        q.setPermissionMode((live.wantMode ?? "default") as PermissionMode),
        CONTROL_TIMEOUT_MS,
        "setPermissionMode",
      );
      live.mode = live.wantMode;
    }
  }

  return {
    cancelIdleClose,
    scheduleIdleClose,
    closeQuery,
    refreshUsage,
    startQuery,
    syncLiveSettings,
  };
}
