/**
 * Adapter Claude Code — Claude Agent SDK di balik kontrak `AgentClient`.
 *
 * Claude Code tidak punya mode server; SDK menjalankan CLI `claude` sebagai
 * subprocess per Session (`query()` dengan streaming input):
 *
 * - Proses `claude` di-spawn malas saat prompt pertama sebuah Session dan
 *   ditutup setelah idle lama — prompt berikutnya melanjutkan via `resume`.
 * - Pesan SDK diterjemahkan ke `AgentEvent` (bentuk opencode v2) oleh
 *   `messages.ts` + `ClaudeTurnTranslator`.
 * - `canUseTool` -> `permission.asked` / `form.created` (AskUserQuestion);
 *   Promise-nya ditahan sampai `permission.reply` / `form.reply|cancel`
 *   (`asks.ts`).
 * - Konfigurasi mengikuti Claude Code user (`settingSources` user + project
 *   + local): auth, custom inference, model default, MCP, skill, CLAUDE.md.
 * - MCP & skill dikendalikan tanpa restart proses (`catalog.ts`): toggle /
 *   reconnect MCP dan `reloadSkills` dikirim ke tiap proses `claude` yang hidup.
 * - Akhir turn = `session_state_changed: idle` (otoritatif, diaktifkan lewat
 *   `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS`); fallback ke pesan `result`.
 *   Turn ditutup `session.execution.succeeded|failed|interrupted`.
 *
 * File ini hanya merakit modul-modul di atas menjadi satu `AgentClient`:
 * - `processes.ts`: siklus hidup proses per Session (spawn/resume, sinkron
 *   model/effort/mode, idle close, pengukuran usage);
 * - `session-api.ts`: operasi Session (prompt, interrupt, hapus, dst.);
 * - `external.ts`: Session yang dibuat Claude Desktop / CLI (daftar,
 *   riwayat, fork) untuk diimpor;
 * - `events.ts`: listener `AgentEvent`.
 */
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { AgentClient } from "../types";
import { createPendingAsks } from "./asks";
import { createClaudeCatalog } from "./catalog";
import { CLAUDE_IDLE_CLOSE_MS, CLAUDE_PERMISSION_MODES } from "./constants";
import { ClaudeEventHub } from "./events";
import { createClaudeExternal } from "./external";
import { gitFileStatus } from "./files";
import { type ClaudeHostSessions, createHostSessions } from "./host-sessions";
import { createLiveSession, type LiveSession } from "./live-session";
import { createClaudeProcesses } from "./processes";
import {
  type ClaudeQueryFn,
  type ClaudeQueryLike,
  type ClaudeTranscripts,
  defaultQuery,
  defaultTranscripts,
} from "./sdk";
import { createClaudeSessionApi } from "./session-api";

export interface ClaudeClientOptions {
  query?: ClaudeQueryFn;
  transcripts?: ClaudeTranscripts;
  /** Jejak Session milik Claude Desktop / CLI yang sedang berjalan. */
  host?: ClaudeHostSessions;
  /** Lingkungan proses `claude` (default `process.env`). */
  env?: Record<string, string | undefined>;
  /** Path binary `claude`; default binary bawaan SDK. */
  executablePath?: string;
  idleCloseMs?: number;
  /** Jeda pengecekan ulang transcript setelah proses ditutup saat hapus. */
  deleteSettleMs?: number;
  now?: () => number;
  setTimeoutFn?: (cb: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

export interface ClaudeClient extends AgentClient {
  /** Tutup seluruh proses `claude` milik Project ini. */
  close(): Promise<void>;
}

export function createClaudeClient(cwd: string, opts: ClaudeClientOptions = {}): ClaudeClient {
  const runQuery = opts.query ?? defaultQuery;
  const transcripts = opts.transcripts ?? defaultTranscripts;
  const baseEnv = opts.env ?? process.env;
  const host = opts.host ?? createHostSessions(baseEnv);
  const idleCloseMs = opts.idleCloseMs ?? CLAUDE_IDLE_CLOSE_MS;
  const deleteSettleMs = opts.deleteSettleMs ?? 1000;
  const now = opts.now ?? Date.now;
  const setTimeoutFn = opts.setTimeoutFn ?? ((cb: () => void, ms: number) => setTimeout(cb, ms));
  const clearTimeoutFn =
    opts.clearTimeoutFn ??
    ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  const events = new ClaudeEventHub();
  const { emit } = events;
  const sessions = new Map<string, LiveSession>();

  function sharedOptions(): Options {
    return {
      cwd,
      // Ikuti konfigurasi Claude Code user apa adanya (auth, custom
      // inference, model, MCP, CLAUDE.md) — konsisten dengan `claude` CLI.
      settingSources: ["user", "project", "local"],
      env: { ...baseEnv, CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1" },
      ...(opts.executablePath ? { pathToClaudeCodeExecutable: opts.executablePath } : {}),
    };
  }

  /** Proses `claude` yang sedang hidup (urut Session). */
  function liveQueries(): ClaudeQueryLike[] {
    return [...sessions.values()]
      .map((live) => live.query)
      .filter((q): q is ClaudeQueryLike => q !== null);
  }

  function getOrCreate(id: string, persisted: boolean): LiveSession {
    let live = sessions.get(id);
    if (!live) {
      live = createLiveSession(id, persisted, emit);
      sessions.set(id, live);
    }
    return live;
  }

  const asks = createPendingAsks(emit);
  const catalog = createClaudeCatalog({
    cwd,
    env: baseEnv,
    now,
    runQuery,
    sharedOptions,
    liveQueries,
  });
  const processes = createClaudeProcesses({
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
  });
  const session = createClaudeSessionApi({
    cwd,
    transcripts,
    host,
    now,
    deleteSettleMs,
    sessions,
    getOrCreate,
    asks,
    processes,
  });

  return {
    kind: "claude-code",
    directory: cwd,
    capabilities: { skillReload: false, permissionModes: CLAUDE_PERMISSION_MODES },
    session,
    permission: {
      reply: ({ requestID, decision }) => asks.replyPermission(requestID, decision),
    },
    form: {
      reply: ({ formID, answer }) => asks.replyForm(formID, answer),
      cancel: ({ formID }) => asks.cancelForm(formID),
    },
    model: { list: catalog.listModels },
    agent: {
      async list() {
        return { ok: true, data: [] };
      },
    },
    mcp: {
      list: catalog.listMcp,
      setEnabled: catalog.setMcpEnabled,
      reconnect: catalog.reconnectMcp,
    },
    skill: { list: catalog.listSkills },
    // Slash command dijalankan CLI sendiri dari teks prompt `/nama args`.
    command: { list: catalog.listCommands },
    file: { find: catalog.findFiles },
    vcs: {
      async status() {
        return { ok: true, data: await gitFileStatus(cwd) };
      },
    },
    location: { reload: catalog.reload },
    event: {
      subscribe(cb) {
        return events.subscribe(cb);
      },
    },
    // Session Desktop/CLI berbagi storage transcript dengan proses KCG.
    external: createClaudeExternal({ cwd, transcripts, host }),
    async close() {
      for (const live of sessions.values()) {
        asks.dropSession(live.id, "Claude Code backend stopped.");
        processes.closeQuery(live);
      }
    },
  };
}
