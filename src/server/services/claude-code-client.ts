/**
 * Claude_Code_Client — backend Claude Code lewat Claude Agent SDK.
 *
 * Claude Code tidak punya mode server HTTP seperti `opencode serve`; SDK
 * menjalankan CLI `claude` sebagai subprocess per Session (`query()` dengan
 * streaming input). Modul ini membungkusnya di balik kontrak yang SAMA
 * dengan `OpenCodeClient`/`OpenCodeServerManager`, sehingga Session_Manager,
 * TurnStream, dan kartu Interactive_Prompt dipakai ulang apa adanya:
 *
 * - "Server" per Project hanyalah objek in-process (tanpa port); proses
 *   `claude` di-spawn malas saat prompt pertama sebuah Session dan ditutup
 *   setelah idle lama — prompt berikutnya melanjutkan via `resume`.
 * - Pesan SDK diterjemahkan ke event gaya opencode (`claude-code-translate`)
 *   lalu dipancarkan ke subscriber seperti SSE `GET /event`.
 * - `canUseTool` -> event `permission.asked` / `question.asked`; Promise-nya
 *   ditahan sampai `replyPermission` / `replyQuestion` dipanggil.
 * - Konfigurasi mengikuti Claude Code user (`settingSources` user + project
 *   + local): auth, custom inference (`env` di settings.json), model
 *   default, MCP, skill, CLAUDE.md — sama seperti `claude` di terminal.
 * - Akhir turn = `session_state_changed: idle` (otoritatif, diaktifkan lewat
 *   `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS`); fallback ke pesan `result`.
 */
import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  CanUseTool,
  McpServerStatus,
  ModelInfo,
  Options,
  PermissionMode,
  PermissionResult,
  PermissionUpdate,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  deleteSession as sdkDeleteSession,
  getSessionInfo as sdkGetSessionInfo,
  query as sdkQuery,
} from "@anthropic-ai/claude-agent-sdk";
import type { SessionModel } from "../../types";
import type { Result, SimpleResult } from "../result";
import { ClaudeTurnTranslator, permissionName, permissionTarget } from "./claude-code-translate";
import { mergeClaudeMcp, readClaudeMcpConfig } from "./claude-mcp";
import { claudeGlobalSkillsDir, listClaudeSkills } from "./claude-skills";
import type {
  AgentOption,
  McpServerInfo,
  ModelOption,
  OpenCodeClient,
  OpenCodeEvent,
  OpenCodeFileChange,
  OpenCodeFileRef,
  OpenCodePermissionReply,
  OpenCodeTodo,
} from "./opencode-client";
import { OC_REQUEST_GONE } from "./opencode-client";
import type { OpenCodeServerHandle, OpenCodeServerManager } from "./opencode-server";

/** `providerID` model Claude Code di `SessionModel` / pemilih model. */
export const CLAUDE_PROVIDER_ID = "claude-code";
/** Proses `claude` yang idle selama ini ditutup (prompt berikutnya resume). */
export const CLAUDE_IDLE_CLOSE_MS = 10 * 60_000;
/** Batas tunggu request kontrol SDK (daftar model, status MCP, interrupt). */
const CONTROL_TIMEOUT_MS = 30_000;
/** Cache daftar model (spawn proses hanya untuk daftar itu mahal). */
const MODELS_CACHE_MS = 5 * 60_000;
/** Baris stderr terakhir yang disimpan untuk pesan error crash. */
const STDERR_TAIL_LINES = 20;

/**
 * Mode permission yang ditawarkan sebagai "agent" di pemilih mode composer.
 * `default` = ikuti `permissions.defaultMode` di settings Claude Code user.
 */
export const CLAUDE_AGENTS: AgentOption[] = [
  { name: "default", mode: "primary", description: "Follow your Claude Code permission settings" },
  { name: "acceptEdits", mode: "primary", description: "Auto-approve file edits" },
  { name: "plan", mode: "primary", description: "Plan only — no edits or commands" },
];

const PERMISSION_MODES = new Set<string>(["default", "acceptEdits", "plan"]);

/** Subset `Query` SDK yang dipakai (di-mock pada test). */
export interface ClaudeQueryLike extends AsyncIterable<SDKMessage> {
  interrupt(): Promise<unknown>;
  setModel(model?: string): Promise<void>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  supportedModels(): Promise<ModelInfo[]>;
  mcpServerStatus(): Promise<McpServerStatus[]>;
  close(): void;
}

export type ClaudeQueryFn = (params: {
  prompt: AsyncIterable<SDKUserMessage>;
  options: Options;
}) => ClaudeQueryLike;

/** Akses transcript Session di `~/.claude/projects` (di-mock pada test). */
export interface ClaudeTranscripts {
  exists(sessionId: string, dir: string): Promise<boolean>;
  remove(sessionId: string, dir: string): Promise<void>;
}

export interface ClaudeCodeClientOptions {
  query?: ClaudeQueryFn;
  transcripts?: ClaudeTranscripts;
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

export interface ClaudeCodeClient extends OpenCodeClient {
  /** Tutup seluruh proses `claude` milik Project ini. */
  close(): Promise<void>;
}

const defaultTranscripts: ClaudeTranscripts = {
  async exists(sessionId, dir) {
    try {
      return (await sdkGetSessionInfo(sessionId, { dir })) !== undefined;
    } catch {
      return false;
    }
  },
  async remove(sessionId, dir) {
    await sdkDeleteSession(sessionId, { dir });
  },
};

/** Antrean pesan user untuk streaming input `query()`. */
class InputQueue<T> implements AsyncIterable<T> {
  private readonly items: T[] = [];
  private waiter: ((r: IteratorResult<T>) => void) | null = null;
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    const waiter = this.waiter;
    if (waiter) {
      this.waiter = null;
      waiter({ value: item, done: false });
    } else {
      this.items.push(item);
    }
  }

  close(): void {
    this.closed = true;
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item !== undefined) return Promise.resolve({ value: item, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => {
          this.waiter = resolve;
        });
      },
    };
  }
}

/** Satu Session Claude Code (id = UUID session Claude Code). */
interface LiveSession {
  id: string;
  query: ClaudeQueryLike | null;
  input: InputQueue<SDKUserMessage> | null;
  translator: ClaudeTurnTranslator;
  /** Model / mode / instruksi yang berlaku pada proses aktif. */
  model: string | null;
  mode: string | null;
  system: string | null;
  /** Transcript sudah ada di disk -> proses berikutnya pakai `resume`. */
  persisted: boolean;
  /** Turn sedang berjalan (dari `session_state_changed`). */
  running: boolean;
  /** CLI memancarkan `session_state_changed` (bila tidak: fallback `result`). */
  sawState: boolean;
  /** Idle berikutnya milik turn yang di-interrupt — jangan tutup turn baru. */
  skipNextIdle: boolean;
  /** Selesai saat turn yang di-interrupt benar-benar berhenti (idle). */
  interruptSettled: { promise: Promise<void>; resolve: () => void } | null;
  /** Error turn sudah dilaporkan (hindari banner ganda dari `result`). */
  turnErrored: boolean;
  /** Proses sengaja ditutup (bukan crash). */
  closing: boolean;
  todos: OpenCodeTodo[];
  stderr: string[];
  idleTimer: unknown;
  /** Selesai saat stream proses aktif berakhir (proses keluar). */
  pumpDone: Promise<void> | null;
}

interface PendingAsk {
  sessionId: string;
  kind: "permission" | "question";
  input: Record<string, unknown>;
  suggestions?: PermissionUpdate[];
  allowAlways: boolean;
  resolve: (result: PermissionResult) => void;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Status MCP SDK -> status gaya opencode yang dipakai UI. */
function mcpStatus(status: string): McpServerInfo["status"] {
  switch (status) {
    case "connected":
      return "connected";
    case "failed":
      return "failed";
    case "needs-auth":
      return "needs_auth";
    case "disabled":
      return "disabled";
    default:
      return "unknown";
  }
}

/** Gambar & PDF dikirim inline ke model; mime lain dirujuk lewat path. */
const INLINE_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/**
 * Bangun konten pesan user: teks + gambar/PDF base64. Referensi `@file` dan
 * lampiran non-inline ditulis sebagai daftar path absolut agar Claude
 * membacanya sendiri dengan tool Read.
 */
async function buildUserContent(
  text: string,
  files: OpenCodeFileRef[],
): Promise<SDKUserMessage["message"]["content"]> {
  const blocks: Exclude<SDKUserMessage["message"]["content"], string> = [];
  const referenced: string[] = [];
  for (const f of files) {
    let absPath: string;
    try {
      absPath = fileURLToPath(f.url);
    } catch {
      continue;
    }
    if (INLINE_IMAGE_MIMES.has(f.mime) || f.mime === "application/pdf") {
      try {
        const data = Buffer.from(await Bun.file(absPath).arrayBuffer()).toString("base64");
        if (f.mime === "application/pdf") {
          blocks.push({
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data },
          });
        } else {
          blocks.push({
            type: "image",
            source: {
              type: "base64",
              media_type: f.mime as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
              data,
            },
          });
        }
        continue;
      } catch {
        // Gagal dibaca -> rujuk path saja.
      }
    }
    referenced.push(`- ${f.filename}: ${absPath}`);
  }
  const fullText =
    referenced.length === 0
      ? text
      : [text, "Referenced files:", ...referenced].filter((l) => l !== "").join("\n");
  if (blocks.length === 0) return fullText;
  return fullText.trim() === "" ? blocks : [{ type: "text", text: fullText }, ...blocks];
}

/** Jalankan `git` (argumen array, tanpa shell); stdout mentah atau null. */
async function runGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    const proc = Bun.spawn(["git", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
    });
    const timer = setTimeout(() => proc.kill(), 5000);
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    clearTimeout(timer);
    return code === 0 ? out : null;
  } catch {
    return null;
  }
}

/** File yang berubah di worktree (`git status` + `git diff --numstat HEAD`). */
export async function gitFileStatus(cwd: string): Promise<OpenCodeFileChange[]> {
  const status = await runGit(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (status === null) return [];
  const counts = new Map<string, { added: number; removed: number }>();
  const numstat = await runGit(cwd, ["diff", "--numstat", "-z", "HEAD"]);
  if (numstat !== null) {
    // Format -z: "added\tremoved\tpath\0" (rename: "a\tr\t\0old\0new\0").
    const tokens = numstat.split("\0");
    for (let i = 0; i < tokens.length; i++) {
      const [a, r, p] = (tokens[i] ?? "").split("\t");
      if (a === undefined || r === undefined) continue;
      let file = p ?? "";
      if (file === "") {
        i += 2;
        file = tokens[i] ?? "";
      }
      if (file === "") continue;
      counts.set(file, {
        added: Number.parseInt(a, 10) || 0,
        removed: Number.parseInt(r, 10) || 0,
      });
    }
  }
  const out: OpenCodeFileChange[] = [];
  const entries = status.split("\0");
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] ?? "";
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    const file = entry.slice(3);
    // Rename/copy: entri berikutnya adalah path asal — lewati.
    if (xy[0] === "R" || xy[0] === "C") i += 1;
    const kind: OpenCodeFileChange["status"] =
      xy === "??" || xy.includes("A") ? "added" : xy.includes("D") ? "deleted" : "modified";
    const c = counts.get(file) ?? { added: 0, removed: 0 };
    out.push({ path: file, added: c.added, removed: c.removed, status: kind });
  }
  return out;
}

/** Peringkat path untuk autocomplete `@file` (null = tidak cocok). */
function matchScore(file: string, q: string): number | null {
  if (q === "") return file.length;
  const lower = file.toLowerCase();
  const base = lower.slice(lower.lastIndexOf("/") + 1);
  if (base.startsWith(q)) return file.length;
  if (base.includes(q)) return 1000 + file.length;
  if (lower.includes(q)) return 2000 + file.length;
  return null;
}

export function createClaudeCodeClient(
  cwd: string,
  opts: ClaudeCodeClientOptions = {},
): ClaudeCodeClient {
  const runQuery: ClaudeQueryFn =
    opts.query ?? ((params) => sdkQuery(params) as unknown as ClaudeQueryLike);
  const transcripts = opts.transcripts ?? defaultTranscripts;
  const baseEnv = opts.env ?? process.env;
  const idleCloseMs = opts.idleCloseMs ?? CLAUDE_IDLE_CLOSE_MS;
  const deleteSettleMs = opts.deleteSettleMs ?? 1000;
  const now = opts.now ?? Date.now;
  const setTimeoutFn = opts.setTimeoutFn ?? ((cb: () => void, ms: number) => setTimeout(cb, ms));
  const clearTimeoutFn =
    opts.clearTimeoutFn ??
    ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  const listeners = new Set<(ev: OpenCodeEvent) => void>();
  const sessions = new Map<string, LiveSession>();
  const pending = new Map<string, PendingAsk>();
  /** Status MCP terakhir dari pesan `system/init`. */
  let lastMcp: McpServerInfo[] = [];
  let modelsCache: { at: number; data: ModelOption[] } | null = null;
  let fileCache: { at: number; files: string[] } | null = null;

  function emit(ev: OpenCodeEvent): void {
    for (const cb of listeners) {
      try {
        cb(ev);
      } catch (e) {
        console.warn("[kcg-code] claude-code event handler gagal:", e);
      }
    }
  }

  function getOrCreate(id: string, persisted: boolean): LiveSession {
    let live = sessions.get(id);
    if (!live) {
      live = {
        id,
        query: null,
        input: null,
        translator: new ClaudeTurnTranslator(id, emit, now),
        model: null,
        mode: null,
        system: null,
        persisted,
        running: false,
        sawState: false,
        skipNextIdle: false,
        interruptSettled: null,
        turnErrored: false,
        closing: false,
        todos: [],
        stderr: [],
        idleTimer: undefined,
        pumpDone: null,
      };
      sessions.set(id, live);
    }
    return live;
  }

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

  function cancelIdleClose(live: LiveSession): void {
    if (live.idleTimer !== undefined) {
      clearTimeoutFn(live.idleTimer);
      live.idleTimer = undefined;
    }
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

  function scheduleIdleClose(live: LiveSession): void {
    cancelIdleClose(live);
    live.idleTimer = setTimeoutFn(() => {
      live.idleTimer = undefined;
      if (!live.running) closeQuery(live);
    }, idleCloseMs);
  }

  /** Tolak seluruh ask yang menunggu untuk Session (abort/close). */
  function dropPending(sessionId: string, message: string): void {
    for (const [id, ask] of pending) {
      if (ask.sessionId !== sessionId) continue;
      pending.delete(id);
      ask.resolve({ behavior: "deny", message, interrupt: true });
    }
  }

  function settleInterrupt(live: LiveSession): void {
    live.skipNextIdle = false;
    live.interruptSettled?.resolve();
    live.interruptSettled = null;
  }

  function emitIdle(live: LiveSession): void {
    live.running = false;
    if (live.skipNextIdle) {
      // Idle milik turn yang di-interrupt: turn lokal sudah dibuang.
      settleInterrupt(live);
      return;
    }
    emit({ type: "session.idle", sessionID: live.id });
  }

  function emitError(live: LiveSession, message: string): void {
    emit({
      type: "session.error",
      sessionID: live.id,
      error: { name: "UnknownError", data: { message } },
    });
  }

  function handleMessage(live: LiveSession, msg: SDKMessage): void {
    const m = msg as unknown as Record<string, unknown>;
    // Tanda hidup apa pun -> reset timer idle turn (tool lama, retry, dll).
    if (live.running)
      emit({ type: "session.status", sessionID: live.id, status: { type: "busy" } });

    if (m.type === "system") {
      if (m.subtype === "init") {
        live.persisted = true;
        const servers = Array.isArray(m.mcp_servers) ? m.mcp_servers : [];
        lastMcp = servers
          .filter((s): s is { name: string; status: string } => typeof s?.name === "string")
          .map((s) => ({ name: s.name, status: mcpStatus(String(s.status)), error: null }));
        return;
      }
      if (m.subtype === "session_state_changed") {
        live.sawState = true;
        if (m.state === "running") {
          live.running = true;
          cancelIdleClose(live);
        } else if (m.state === "idle") {
          emitIdle(live);
          scheduleIdleClose(live);
        }
        return;
      }
    }

    if (m.type === "assistant" && typeof m.error === "string") {
      // Error API (auth, rate limit, model tidak ada) dilaporkan CLI sebagai
      // pesan assistant sintetis — tampilkan sebagai error, bukan jawaban.
      const content = (m.message as { content?: unknown } | undefined)?.content;
      const text = Array.isArray(content)
        ? content
            .map((b) => (b as { text?: unknown })?.text)
            .filter((t): t is string => typeof t === "string")
            .join("\n")
        : "";
      live.turnErrored = true;
      emitError(live, text.trim() || `Claude Code error: ${m.error.replace(/_/g, " ")}`);
      return;
    }

    if (m.type === "result") {
      // Turn yang di-interrupt sudah dibuang Session_Manager: hasilnya
      // (biasanya error_during_execution) bukan kegagalan yang perlu banner.
      const aborted = live.skipNextIdle;
      if (!aborted && !live.turnErrored && (m.subtype !== "success" || m.is_error === true)) {
        const errors = Array.isArray(m.errors) ? m.errors.filter((e) => typeof e === "string") : [];
        const message =
          errors.join("\n") ||
          (typeof m.result === "string" && m.result) ||
          `Claude Code stopped: ${String(m.subtype).replace(/_/g, " ")}`;
        emitError(live, message);
      }
      live.turnErrored = false;
      // CLI lama tanpa `session_state_changed`: `result` menutup turn.
      if (!live.sawState) {
        emitIdle(live);
        scheduleIdleClose(live);
      }
      return;
    }

    const effects = live.translator.handle(m);
    if (effects.todos) live.todos = effects.todos;
  }

  /** Baca stream proses sampai selesai; crash dilaporkan sebagai error turn. */
  async function pump(live: LiveSession, q: ClaudeQueryLike): Promise<void> {
    try {
      for await (const msg of q) {
        if (live.query !== q) break;
        handleMessage(live, msg);
      }
    } catch (e) {
      if (live.query === q && !live.closing) {
        const tail = live.stderr.slice(-5).join("\n").trim();
        const detail = (e as Error).message ?? String(e);
        emitError(live, `Claude Code exited unexpectedly: ${detail}${tail ? `\n${tail}` : ""}`);
      }
    } finally {
      if (live.query === q) {
        const wasRunning = live.running;
        live.query = null;
        live.input?.close();
        live.input = null;
        dropPending(live.id, "Claude Code process ended.");
        if (wasRunning && !live.closing) emitIdle(live);
        live.running = false;
        settleInterrupt(live);
      }
      live.closing = false;
    }
  }

  async function canUseTool(
    live: LiveSession,
    toolName: string,
    input: Record<string, unknown>,
    options: Parameters<CanUseTool>[2],
  ): Promise<PermissionResult> {
    const isQuestion = toolName === "AskUserQuestion";
    const requestID = `${isQuestion ? "que" : "per"}_${randomUUID()}`;
    const result = new Promise<PermissionResult>((resolve) => {
      pending.set(requestID, {
        sessionId: live.id,
        kind: isQuestion ? "question" : "permission",
        input,
        suggestions: options.suggestions,
        allowAlways: options.suppressAlwaysAllowRule !== true,
        resolve,
      });
      options.signal.addEventListener(
        "abort",
        () => {
          if (!pending.delete(requestID)) return;
          resolve({ behavior: "deny", message: "Aborted.", interrupt: true });
        },
        { once: true },
      );
    });

    if (isQuestion) {
      const questions = Array.isArray(input.questions) ? input.questions : [];
      emit({
        type: "question.asked",
        sessionID: live.id,
        requestID,
        questions: questions.map((q) => {
          const item = (q ?? {}) as Record<string, unknown>;
          return {
            question: item.question,
            header: item.header,
            options: item.options,
            multiple: item.multiSelect === true,
            custom: true,
          };
        }),
      });
    } else {
      // Akses di luar direktori project dilaporkan CLI lewat `blockedPath`.
      const blocked = typeof options.blockedPath === "string" ? options.blockedPath : null;
      const target = blocked ?? permissionTarget(input);
      emit({
        type: "permission.asked",
        sessionID: live.id,
        requestID,
        permission: blocked ? "external_directory" : permissionName(toolName),
        patterns: target ? [target] : [],
      });
    }
    return result;
  }

  /** Spawn proses `claude` untuk Session (resume bila transcript sudah ada). */
  async function startQuery(
    live: LiveSession,
    model: string | null,
    mode: string | null,
    system: string | null,
  ): Promise<void> {
    if (!live.persisted) live.persisted = await transcripts.exists(live.id, cwd);
    const input = new InputQueue<SDKUserMessage>();
    const options: Options = {
      ...sharedOptions(),
      includePartialMessages: true,
      ...(live.persisted ? { resume: live.id } : { sessionId: live.id }),
      ...(model ? { model } : {}),
      // Tanpa mode eksplisit: ikuti `permissions.defaultMode` user.
      ...(mode && mode !== "default" ? { permissionMode: mode as PermissionMode } : {}),
      ...(system
        ? {
            systemPrompt: {
              type: "preset" as const,
              preset: "claude_code" as const,
              append: system,
            },
          }
        : {}),
      canUseTool: (toolName, toolInput, o) => canUseTool(live, toolName, toolInput, o),
      stderr: (data) => {
        live.stderr.push(...data.split("\n").filter((l) => l.trim() !== ""));
        if (live.stderr.length > STDERR_TAIL_LINES)
          live.stderr.splice(0, live.stderr.length - STDERR_TAIL_LINES);
      },
    };
    const q = runQuery({ prompt: input, options });
    live.query = q;
    live.input = input;
    live.model = model;
    live.mode = mode;
    live.system = system;
    live.closing = false;
    live.sawState = false;
    live.stderr = [];
    live.pumpDone = pump(live, q);
  }

  function selectedModel(model?: SessionModel | null): string | null {
    if (!model || model.providerID !== CLAUDE_PROVIDER_ID) return null;
    return model.modelID === "default" ? null : model.modelID;
  }

  function selectedMode(agent?: string | null): string | null {
    return agent && PERMISSION_MODES.has(agent) ? agent : null;
  }

  async function promptAsync(
    sessionId: string,
    text: string,
    model?: SessionModel | null,
    files: OpenCodeFileRef[] = [],
    agent?: string | null,
    system?: string | null,
  ): Promise<Result<null>> {
    const live = getOrCreate(sessionId, false);
    const wantModel = selectedModel(model);
    const wantMode = selectedMode(agent);
    const wantSystem = system?.trim() ? system : null;
    try {
      const content = await buildUserContent(text, files);
      // Prompt tepat setelah interrupt: tunggu turn lama benar-benar berhenti
      // agar idle-nya tidak menutup turn baru ini.
      if (live.interruptSettled) {
        await withTimeout(live.interruptSettled.promise, 15_000, "interrupt").catch(() =>
          settleInterrupt(live),
        );
      }
      cancelIdleClose(live);
      // Instruksi Project hanya bisa dipasang saat proses dibuat: bila
      // berubah dan tidak ada turn berjalan, proses diganti (resume).
      if (live.query && live.system !== wantSystem && !live.running) closeQuery(live);
      if (!live.query) {
        await startQuery(live, wantModel, wantMode, wantSystem);
      } else {
        const q = live.query;
        if (wantModel !== live.model) {
          await withTimeout(q.setModel(wantModel ?? undefined), CONTROL_TIMEOUT_MS, "setModel");
          live.model = wantModel;
        }
        if (wantMode !== live.mode) {
          await withTimeout(
            q.setPermissionMode((wantMode ?? "default") as PermissionMode),
            CONTROL_TIMEOUT_MS,
            "setPermissionMode",
          );
          live.mode = wantMode;
        }
      }
      live.turnErrored = false;
      live.translator.beginTurn();
      live.input?.push({
        type: "user",
        message: { role: "user", content },
        parent_tool_use_id: null,
      });
      return { ok: true, data: null };
    } catch (e) {
      return { ok: false, error: `Failed to start Claude Code: ${(e as Error).message}` };
    }
  }

  /** Query sementara (tanpa prompt) untuk request kontrol saat tidak ada proses. */
  async function withAnyQuery<T>(fn: (q: ClaudeQueryLike) => Promise<T>): Promise<T> {
    for (const live of sessions.values()) {
      if (live.query) return withTimeout(fn(live.query), CONTROL_TIMEOUT_MS, "control request");
    }
    const input = new InputQueue<SDKUserMessage>();
    const q = runQuery({ prompt: input, options: { ...sharedOptions(), persistSession: false } });
    // Stream harus dikonsumsi agar respons kontrol diproses.
    const drain = (async () => {
      try {
        for await (const _ of q) {
          // abaikan
        }
      } catch {
        // proses ditutup
      }
    })();
    try {
      return await withTimeout(fn(q), CONTROL_TIMEOUT_MS, "control request");
    } finally {
      input.close();
      q.close();
      void drain;
    }
  }

  async function listModels(): Promise<Result<ModelOption[]>> {
    if (modelsCache && now() - modelsCache.at < MODELS_CACHE_MS) {
      return { ok: true, data: modelsCache.data };
    }
    try {
      const models = await withAnyQuery((q) => q.supportedModels());
      const data = models.map((m) => ({
        providerID: CLAUDE_PROVIDER_ID,
        providerName: "Claude Code",
        modelID: m.value,
        name: m.displayName || m.value,
      }));
      modelsCache = { at: now(), data };
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: `CC_MODELS_FAILED: ${(e as Error).message}` };
    }
  }

  async function listMcp(): Promise<Result<McpServerInfo[]>> {
    for (const live of sessions.values()) {
      if (!live.query) continue;
      try {
        const status = await withTimeout(
          live.query.mcpServerStatus(),
          CONTROL_TIMEOUT_MS,
          "mcpServerStatus",
        );
        lastMcp = status.map((s) => ({
          name: s.name,
          status: mcpStatus(s.status),
          error: s.error ?? null,
        }));
      } catch {
        // pakai status terakhir
      }
      break;
    }
    // Server terkonfigurasi tetap tampil walau belum ada proses `claude`
    // (status `unknown` sampai proses berjalan dan melaporkannya).
    const configured = await readClaudeMcpConfig(cwd, baseEnv);
    return { ok: true, data: mergeClaudeMcp(configured, lastMcp) };
  }

  async function projectFiles(): Promise<string[]> {
    if (fileCache && now() - fileCache.at < 10_000) return fileCache.files;
    const out = await runGit(cwd, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
    let files: string[];
    if (out !== null) {
      files = out.split("\0").filter((f) => f !== "");
    } else {
      files = [];
      const glob = new Bun.Glob("**/*");
      for await (const f of glob.scan({ cwd, onlyFiles: true })) {
        if (f.startsWith("node_modules/") || f.startsWith(".git/")) continue;
        files.push(f);
        if (files.length >= 20_000) break;
      }
    }
    fileCache = { at: now(), files };
    return files;
  }

  async function findFiles(q: string): Promise<Result<string[]>> {
    try {
      const needle = q.trim().toLowerCase();
      const scored: { file: string; score: number }[] = [];
      for (const file of await projectFiles()) {
        const score = matchScore(file, needle);
        if (score !== null) scored.push({ file, score });
      }
      scored.sort((a, b) => a.score - b.score);
      return { ok: true, data: scored.slice(0, 50).map((s) => s.file) };
    } catch (e) {
      return { ok: false, error: `CC_FIND_FILES_FAILED: ${(e as Error).message}` };
    }
  }

  function takePending(requestId: string, kind: PendingAsk["kind"]): PendingAsk | null {
    const ask = pending.get(requestId);
    if (!ask || ask.kind !== kind) return null;
    pending.delete(requestId);
    return ask;
  }

  async function replyPermission(
    requestId: string,
    reply: OpenCodePermissionReply,
  ): Promise<Result<unknown>> {
    const ask = takePending(requestId, "permission");
    if (!ask) return { ok: false, error: OC_REQUEST_GONE };
    if (reply === "reject") {
      ask.resolve({ behavior: "deny", message: "The user denied this tool call." });
    } else {
      // "Always allow" berlaku selama Session (seperti opencode) — tidak
      // menulis aturan ke file settings user dari satu ketukan di HP.
      const updatedPermissions =
        reply === "always" && ask.allowAlways
          ? ask.suggestions?.map((s) => ({ ...s, destination: "session" as const }))
          : undefined;
      ask.resolve({
        behavior: "allow",
        updatedInput: ask.input,
        ...(updatedPermissions?.length ? { updatedPermissions } : {}),
      });
    }
    return { ok: true, data: null };
  }

  async function replyQuestion(requestId: string, answers: string[][]): Promise<Result<unknown>> {
    const ask = takePending(requestId, "question");
    if (!ask) return { ok: false, error: OC_REQUEST_GONE };
    const questions = Array.isArray(ask.input.questions) ? ask.input.questions : [];
    // Format jawaban AskUserQuestion: teks pertanyaan -> label (multi-select
    // digabung koma).
    const map: Record<string, string> = {};
    questions.forEach((q, i) => {
      const question = (q as { question?: unknown } | null)?.question;
      if (typeof question === "string") map[question] = (answers[i] ?? []).join(", ");
    });
    ask.resolve({ behavior: "allow", updatedInput: { ...ask.input, answers: map } });
    return { ok: true, data: null };
  }

  async function rejectQuestion(requestId: string): Promise<Result<unknown>> {
    const ask = takePending(requestId, "question");
    if (!ask) return { ok: false, error: OC_REQUEST_GONE };
    ask.resolve({ behavior: "deny", message: "The user dismissed the question." });
    return { ok: true, data: null };
  }

  async function abortSession(sessionId: string): Promise<Result<unknown>> {
    const live = sessions.get(sessionId);
    if (!live?.query || !live.running) return { ok: true, data: null };
    live.skipNextIdle = true;
    if (!live.interruptSettled) {
      let resolve = () => {};
      const promise = new Promise<void>((r) => {
        resolve = r;
      });
      live.interruptSettled = { promise, resolve };
    }
    dropPending(sessionId, "Interrupted by the user.");
    try {
      await withTimeout(live.query.interrupt(), CONTROL_TIMEOUT_MS, "interrupt");
      return { ok: true, data: null };
    } catch (e) {
      return { ok: false, error: `CC_ABORT_FAILED: ${(e as Error).message}` };
    }
  }

  async function deleteSession(sessionId: string): Promise<SimpleResult> {
    const live = sessions.get(sessionId);
    const wasLive = live?.query != null;
    if (live) {
      dropPending(sessionId, "Session deleted.");
      const done = live.pumpDone;
      closeQuery(live);
      sessions.delete(sessionId);
      // CLI menulis metadata (judul, biaya) ke transcript saat keluar —
      // tunggu proses berhenti agar file tidak muncul lagi setelah dihapus.
      if (wasLive && done) await withTimeout(done, 5000, "close").catch(() => {});
    }
    try {
      if (await transcripts.exists(sessionId, cwd)) await transcripts.remove(sessionId, cwd);
      if (wasLive) {
        await Bun.sleep(deleteSettleMs);
        if (await transcripts.exists(sessionId, cwd)) await transcripts.remove(sessionId, cwd);
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `CC_DELETE_FAILED: ${(e as Error).message}` };
    }
  }

  return {
    async createSession() {
      // Proses `claude` baru di-spawn saat prompt pertama (`sessionId` ini).
      const id = randomUUID();
      getOrCreate(id, false);
      return { ok: true, data: { id, directory: cwd } };
    },
    async getSession(sessionId) {
      if (sessions.has(sessionId)) return { ok: true };
      if (await transcripts.exists(sessionId, cwd)) {
        getOrCreate(sessionId, true);
        return { ok: true };
      }
      return { ok: false, error: "SESSION_NOT_FOUND" };
    },
    listModels,
    async listAgents() {
      return { ok: true, data: CLAUDE_AGENTS };
    },
    listMcp,
    async listSkills() {
      try {
        return { ok: true, data: await listClaudeSkills(cwd, claudeGlobalSkillsDir(baseEnv)) };
      } catch (e) {
        return { ok: false, error: `CC_SKILLS_FAILED: ${(e as Error).message}` };
      }
    },
    async disposeInstance() {
      // Skill/config dibaca ulang tiap proses `claude` baru.
      modelsCache = null;
      return { ok: true };
    },
    deleteSession,
    async sendMessage() {
      return { ok: false, error: "CC_SYNC_MESSAGE_UNSUPPORTED" };
    },
    promptAsync,
    findFiles,
    async listTodos(sessionId) {
      return { ok: true, data: sessions.get(sessionId)?.todos ?? [] };
    },
    async fileStatus() {
      return { ok: true, data: await gitFileStatus(cwd) };
    },
    replyPermission,
    replyQuestion,
    rejectQuestion,
    abortSession,
    subscribeEvents(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    async health() {
      return true;
    },
    async close() {
      for (const live of sessions.values()) {
        dropPending(live.id, "Claude Code backend stopped.");
        closeQuery(live);
      }
    },
  };
}

export interface ClaudeCodeServerManagerOptions {
  clientFactory?: (cwd: string) => ClaudeCodeClient;
}

/**
 * "Server" Claude Code per Project — kontrak sama dengan
 * `OpenCodeServerManager`, tapi tanpa proses/port: hanya klien in-process
 * yang mengelola proses `claude` per Session.
 */
export function createClaudeCodeServerManager(
  opts: ClaudeCodeServerManagerOptions = {},
): OpenCodeServerManager {
  const factory = opts.clientFactory ?? ((cwd: string) => createClaudeCodeClient(cwd));
  const handles = new Map<
    string,
    { handle: OpenCodeServerHandle; client: ClaudeCodeClient; cwd: string }
  >();

  async function ensureServer(projectId: string, projectPath: string) {
    const cur = handles.get(projectId);
    if (cur && cur.cwd === projectPath) return { ok: true as const, data: cur.handle };
    let isDir = false;
    try {
      isDir = existsSync(projectPath) && statSync(projectPath).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) return { ok: false as const, error: "PROJECT_DIR_NOT_FOUND" };
    if (cur) await cur.client.close();
    const client = factory(path.resolve(projectPath));
    const handle: OpenCodeServerHandle = {
      projectId,
      baseUrl: `claude-code://${projectPath}`,
      client,
    };
    handles.set(projectId, { handle, client, cwd: projectPath });
    return { ok: true as const, data: handle };
  }

  async function stopServer(projectId: string): Promise<void> {
    const cur = handles.get(projectId);
    if (!cur) return;
    handles.delete(projectId);
    await cur.client.close();
  }

  return {
    ensureServer,
    ensureFreshServer: ensureServer,
    getServer: (projectId) => handles.get(projectId)?.handle,
    stopServer,
    async stopAll() {
      await Promise.all([...handles.keys()].map((id) => stopServer(id)));
    },
    // Tidak ada proses server yang bisa keluar; crash proses `claude` per
    // Session dilaporkan sebagai error turn (lihat `pump`).
    onServerExit() {},
  };
}
