/**
 * Adapter Claude Code — Claude Agent SDK di balik kontrak `AgentClient`.
 *
 * Claude Code tidak punya mode server; SDK menjalankan CLI `claude` sebagai
 * subprocess per Session (`query()` dengan streaming input):
 *
 * - Proses `claude` di-spawn malas saat prompt pertama sebuah Session dan
 *   ditutup setelah idle lama — prompt berikutnya melanjutkan via `resume`.
 * - Pesan SDK diterjemahkan ke `AgentEvent` (bentuk opencode v2) oleh
 *   `ClaudeTurnTranslator`.
 * - `canUseTool` -> `permission.asked` / `form.created` (AskUserQuestion);
 *   Promise-nya ditahan sampai `permission.reply` / `form.reply|cancel`.
 * - Konfigurasi mengikuti Claude Code user (`settingSources` user + project
 *   + local): auth, custom inference, model default, MCP, skill, CLAUDE.md.
 * - Akhir turn = `session_state_changed: idle` (otoritatif, diaktifkan lewat
 *   `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS`); fallback ke pesan `result`.
 *   Turn ditutup `session.execution.succeeded|failed|interrupted`.
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
import type {
  FileChange,
  McpServerInfo,
  ModelOption,
  PermissionModeOption,
  TodoItem,
} from "../../../types";
import type { Result, SimpleResult } from "../../result";
import { mergeClaudeMcp, readClaudeMcpConfig } from "../../services/claude-mcp";
import { claudeGlobalSkillsDir, listClaudeSkills } from "../../services/claude-skills";
import {
  AGENT_REQUEST_GONE,
  type AgentBackend,
  type AgentClient,
  type AgentError,
  type AgentEvent,
  type AgentForm,
  type AgentFormAnswer,
  type AgentPromptFile,
  type ModelSelection,
} from "../types";
import { ClaudeTurnTranslator, permissionName, permissionTarget } from "./translate";

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
 * Permission mode Claude Code (`PermissionMode` SDK). Session tanpa pilihan
 * (`null`) mengikuti `permissions.defaultMode` di settings user.
 */
export const CLAUDE_PERMISSION_MODES: PermissionModeOption[] = [
  {
    id: "default",
    label: "Ask before acting",
    description: "Asks before edits and commands",
  },
  {
    id: "acceptEdits",
    label: "Accept edits",
    description: "Auto-approves file edits; still asks for commands",
  },
  {
    id: "plan",
    label: "Plan",
    description: "Read-only: researches and proposes a plan for your approval",
  },
  {
    id: "auto",
    label: "Auto",
    description: "A classifier approves safe actions and asks about the rest",
  },
  {
    id: "dontAsk",
    label: "Don't ask",
    description: "Never asks — anything not pre-approved is denied",
  },
  {
    id: "bypassPermissions",
    label: "Bypass permissions",
    description: "Runs every tool without asking. Use only in a sandbox",
    dangerous: true,
  },
];

const PERMISSION_MODE_IDS = new Set(CLAUDE_PERMISSION_MODES.map((m) => m.id));

/** Keputusan kartu persetujuan rencana (`ExitPlanMode`) -> mode berikutnya. */
const PLAN_DECISIONS = [
  { value: "acceptEdits", label: "Yes, and auto-accept edits" },
  { value: "default", label: "Yes, and approve each edit" },
  { value: "plan", label: "No, keep planning" },
] as const;

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

export interface ClaudeClientOptions {
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

export interface ClaudeClient extends AgentClient {
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
  /** Pilihan untuk prompt berikutnya (`session.switchModel/setPermissionMode/instructions`). */
  wantModel: string | null;
  wantMode: string | null;
  /** Mode yang terakhir dilaporkan CLI (`system/init` / `system/status`). */
  reportedMode: string | null;
  wantSystem: string | null;
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
  /** Error turn pertama (dilaporkan saat turn ditutup). */
  turnError: AgentError | null;
  /** Proses sengaja ditutup (bukan crash). */
  closing: boolean;
  todos: TodoItem[];
  stderr: string[];
  idleTimer: unknown;
  /** Selesai saat stream proses aktif berakhir (proses keluar). */
  pumpDone: Promise<void> | null;
}

interface PendingAsk {
  sessionId: string;
  kind: "permission" | "question" | "plan";
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

/** Status MCP SDK -> status yang dipakai UI. */
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
  files: AgentPromptFile[],
): Promise<SDKUserMessage["message"]["content"]> {
  const blocks: Exclude<SDKUserMessage["message"]["content"], string> = [];
  const referenced: string[] = [];
  for (const f of files) {
    let absPath: string;
    try {
      absPath = fileURLToPath(f.uri);
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
    referenced.push(`- ${f.name}: ${absPath}`);
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
      windowsHide: true,
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
export async function gitFileStatus(cwd: string): Promise<FileChange[]> {
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
  const out: FileChange[] = [];
  const entries = status.split("\0");
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] ?? "";
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    const file = entry.slice(3);
    // Rename/copy: entri berikutnya adalah path asal — lewati.
    if (xy[0] === "R" || xy[0] === "C") i += 1;
    const kind: FileChange["status"] =
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

/** Form v2 dari input `AskUserQuestion` (`questions[]`). */
export function formFromQuestions(
  id: string,
  sessionID: string,
  input: Record<string, unknown>,
): AgentForm {
  const questions = Array.isArray(input.questions) ? input.questions : [];
  return {
    id,
    sessionID,
    title: "Questions",
    metadata: { kind: "question" },
    fields: questions.map((q, i) => {
      const item = (q ?? {}) as Record<string, unknown>;
      const options = Array.isArray(item.options)
        ? item.options
            .map((o) => (o ?? {}) as Record<string, unknown>)
            .filter((o) => typeof o.label === "string")
            .map((o) => ({
              value: o.label as string,
              label: o.label as string,
              ...(typeof o.description === "string" ? { description: o.description } : {}),
            }))
        : [];
      return {
        key: `q${i}`,
        type: item.multiSelect === true ? "multiselect" : "string",
        ...(typeof item.header === "string" ? { title: item.header } : {}),
        ...(typeof item.question === "string" ? { description: item.question } : {}),
        options,
        custom: true,
      };
    }),
  };
}

/** Field keputusan pada form persetujuan rencana. */
export const PLAN_DECISION_KEY = "decision";

/**
 * Form persetujuan rencana dari input `ExitPlanMode` (Claude selesai
 * merencanakan di plan mode). Isi rencana (markdown) dibawa di
 * `metadata.plan`; jawaban bebas = masukan agar Claude merevisi rencana.
 */
export function planForm(id: string, sessionID: string, input: Record<string, unknown>): AgentForm {
  const plan = typeof input.plan === "string" ? input.plan : null;
  return {
    id,
    sessionID,
    title: "Ready to implement this plan?",
    metadata: { kind: "plan", ...(plan ? { plan } : {}) },
    fields: [
      {
        key: PLAN_DECISION_KEY,
        type: "string",
        title: "Plan",
        description: "Ready to implement this plan?",
        options: PLAN_DECISIONS.map((d) => ({ value: d.value, label: d.label })),
        custom: true,
      },
    ],
  };
}

/**
 * Hasil `canUseTool` untuk keputusan rencana: setuju -> jalankan rencana dan
 * ganti mode Session (seperti Claude Code CLI); tetap merencanakan / masukan
 * bebas -> tolak agar Claude merevisi rencana.
 */
export function planDecision(input: Record<string, unknown>, value: unknown): PermissionResult {
  const decision = typeof value === "string" ? value.trim() : "";
  if (decision === "acceptEdits" || decision === "default") {
    return {
      behavior: "allow",
      updatedInput: input,
      updatedPermissions: [{ type: "setMode", mode: decision, destination: "session" }],
    };
  }
  if (decision === "" || decision === "plan") {
    return { behavior: "deny", message: "The user wants to keep planning. Refine the plan." };
  }
  return {
    behavior: "deny",
    message: `The user wants changes to the plan before implementing it: ${decision}`,
  };
}

export function createClaudeClient(cwd: string, opts: ClaudeClientOptions = {}): ClaudeClient {
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

  const listeners = new Set<(ev: AgentEvent) => void>();
  const sessions = new Map<string, LiveSession>();
  const pending = new Map<string, PendingAsk>();
  /** Status MCP terakhir dari pesan `system/init`. */
  let lastMcp: McpServerInfo[] = [];
  let modelsCache: { at: number; data: ModelOption[] } | null = null;
  let fileCache: { at: number; files: string[] } | null = null;

  function emit(ev: AgentEvent): void {
    for (const cb of listeners) {
      try {
        cb(ev);
      } catch (e) {
        console.warn("[kcg-code] handler event claude-code gagal:", e);
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
        translator: new ClaudeTurnTranslator(id, emit),
        model: null,
        mode: null,
        system: null,
        wantModel: null,
        wantMode: null,
        reportedMode: null,
        wantSystem: null,
        persisted,
        running: false,
        sawState: false,
        skipNextIdle: false,
        interruptSettled: null,
        turnError: null,
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

  /** Turn selesai: succeeded / failed (error tertunda) / interrupted. */
  function emitIdle(live: LiveSession): void {
    live.running = false;
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

  function handleMessage(live: LiveSession, msg: SDKMessage): void {
    const m = msg as unknown as Record<string, unknown>;
    // Tanda hidup apa pun -> reset timer idle turn (tool lama, retry, dll).
    if (live.running) emit({ type: "agent.activity", data: { sessionID: live.id } });

    if (m.type === "system") {
      // Mode yang BERLAKU dilaporkan CLI di `init` (awal tiap turn) dan
      // `status` (mis. setelah rencana disetujui atau mode diganti) —
      // diteruskan agar pilihan di UI selalu mengikuti keadaan sebenarnya.
      if (
        (m.subtype === "init" || m.subtype === "status") &&
        typeof m.permissionMode === "string"
      ) {
        reportMode(live, m.permissionMode);
      }
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
      const kind = m.error === "authentication_failed" ? "provider.auth" : `provider.${m.error}`;
      noteError(live, text.trim() || `Claude Code error: ${m.error.replace(/_/g, " ")}`, kind);
      return;
    }

    if (m.type === "result") {
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
        scheduleIdleClose(live);
      }
      return;
    }

    const effects = live.translator.handle(m);
    if (effects.todos) {
      live.todos = effects.todos;
      emit({ type: "agent.todos.updated", data: { sessionID: live.id, todos: effects.todos } });
    }
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
          const tail = live.stderr.slice(-5).join("\n").trim();
          live.turnError ??= {
            type: "process.exited",
            message: `Claude Code exited unexpectedly.${tail ? `\n${tail}` : ""}`,
          };
        }
        live.query = null;
        live.input?.close();
        live.input = null;
        dropPending(live.id, "Claude Code process ended.");
        if ((wasRunning || live.turnError) && !live.closing) emitIdle(live);
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
    const kind: PendingAsk["kind"] =
      toolName === "AskUserQuestion"
        ? "question"
        : toolName === "ExitPlanMode"
          ? "plan"
          : "permission";
    const requestID = `${kind === "permission" ? "per" : "frm"}_${randomUUID()}`;
    const result = new Promise<PermissionResult>((resolve) => {
      pending.set(requestID, {
        sessionId: live.id,
        kind,
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

    if (kind === "question") {
      emit({ type: "form.created", data: { form: formFromQuestions(requestID, live.id, input) } });
    } else if (kind === "plan") {
      emit({ type: "form.created", data: { form: planForm(requestID, live.id, input) } });
    } else {
      // Akses di luar direktori project dilaporkan CLI lewat `blockedPath`.
      const blocked = typeof options.blockedPath === "string" ? options.blockedPath : null;
      const target = blocked ?? permissionTarget(input);
      emit({
        type: "permission.asked",
        data: {
          id: requestID,
          sessionID: live.id,
          action: blocked ? "external_directory" : permissionName(toolName),
          resources: target ? [target] : [],
        },
      });
    }
    return result;
  }

  /** Spawn proses `claude` untuk Session (resume bila transcript sudah ada). */
  async function startQuery(live: LiveSession): Promise<void> {
    if (!live.persisted) live.persisted = await transcripts.exists(live.id, cwd);
    const input = new InputQueue<SDKUserMessage>();
    const { wantModel: model, wantMode: mode, wantSystem: system } = live;
    const options: Options = {
      ...sharedOptions(),
      includePartialMessages: true,
      ...(live.persisted ? { resume: live.id } : { sessionId: live.id }),
      ...(model ? { model } : {}),
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

  async function prompt(input: {
    sessionID: string;
    text: string;
    files?: AgentPromptFile[];
  }): Promise<SimpleResult> {
    const live = getOrCreate(input.sessionID, false);
    try {
      const content = await buildUserContent(input.text, input.files ?? []);
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
      if (live.query && live.system !== live.wantSystem && !live.running) closeQuery(live);
      if (!live.query) {
        await startQuery(live);
      } else {
        const q = live.query;
        if (live.wantModel !== live.model) {
          await withTimeout(
            q.setModel(live.wantModel ?? undefined),
            CONTROL_TIMEOUT_MS,
            "setModel",
          );
          live.model = live.wantModel;
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
      live.turnError = null;
      live.translator.beginTurn();
      live.input?.push({
        type: "user",
        message: { role: "user", content },
        parent_tool_use_id: null,
      });
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        error: `AGENT_PROMPT_FAILED: Failed to start Claude Code: ${(e as Error).message}`,
      };
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
        const rel = f.replaceAll("\\", "/");
        if (rel.startsWith("node_modules/") || rel.startsWith(".git/")) continue;
        files.push(rel);
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
    requestID: string,
    decision: "once" | "always" | "reject",
  ): Promise<SimpleResult> {
    const ask = takePending(requestID, "permission");
    if (!ask) return { ok: false, error: AGENT_REQUEST_GONE };
    if (decision === "reject") {
      ask.resolve({ behavior: "deny", message: "The user denied this tool call." });
    } else {
      // "Always allow" berlaku selama Session — tidak menulis aturan ke file
      // settings user dari satu ketukan di HP.
      const updatedPermissions =
        decision === "always" && ask.allowAlways
          ? ask.suggestions?.map((s) => ({ ...s, destination: "session" as const }))
          : undefined;
      ask.resolve({
        behavior: "allow",
        updatedInput: ask.input,
        ...(updatedPermissions?.length ? { updatedPermissions } : {}),
      });
    }
    return { ok: true };
  }

  async function replyForm(formID: string, answer: AgentFormAnswer): Promise<SimpleResult> {
    const plan = takePending(formID, "plan");
    if (plan) {
      plan.resolve(planDecision(plan.input, answer[PLAN_DECISION_KEY]));
      return { ok: true };
    }
    const ask = takePending(formID, "question");
    if (!ask) return { ok: false, error: AGENT_REQUEST_GONE };
    const questions = Array.isArray(ask.input.questions) ? ask.input.questions : [];
    // Format jawaban AskUserQuestion: teks pertanyaan -> label (multi-select
    // digabung koma).
    const map: Record<string, string> = {};
    questions.forEach((q, i) => {
      const question = (q as { question?: unknown } | null)?.question;
      if (typeof question !== "string") return;
      const value = answer[`q${i}`];
      map[question] = Array.isArray(value)
        ? value.join(", ")
        : value === undefined
          ? ""
          : String(value);
    });
    ask.resolve({ behavior: "allow", updatedInput: { ...ask.input, answers: map } });
    return { ok: true };
  }

  /**
   * Ganti permission mode Session. Proses `claude` yang hidup diganti modenya
   * SEGERA (`setPermissionMode` SDK) — juga di tengah turn; tanpa proses,
   * mode dipakai saat proses berikutnya di-spawn.
   */
  async function setPermissionMode(sessionId: string, mode: string | null): Promise<SimpleResult> {
    if (mode !== null && !PERMISSION_MODE_IDS.has(mode)) {
      return { ok: false, error: "INVALID_PERMISSION_MODE" };
    }
    const live = getOrCreate(sessionId, false);
    live.wantMode = mode;
    const q = live.query;
    if (!q || mode === live.mode) return { ok: true };
    try {
      await withTimeout(
        q.setPermissionMode((mode ?? "default") as PermissionMode),
        CONTROL_TIMEOUT_MS,
        "setPermissionMode",
      );
      live.mode = mode;
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `AGENT_PERMISSION_MODE_FAILED: ${(e as Error).message}` };
    }
  }

  async function interrupt(sessionId: string): Promise<SimpleResult> {
    const live = sessions.get(sessionId);
    if (!live?.query || !live.running) return { ok: true };
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
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `CC_ABORT_FAILED: ${(e as Error).message}` };
    }
  }

  async function remove(sessionId: string): Promise<SimpleResult> {
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

  function selectedModel(model: ModelSelection | null): string | null {
    if (!model || model.providerID !== CLAUDE_PROVIDER_ID) return null;
    return model.modelID === "default" ? null : model.modelID;
  }

  return {
    kind: "claude-code",
    directory: cwd,
    capabilities: { skillReload: false, permissionModes: CLAUDE_PERMISSION_MODES },
    session: {
      async create() {
        // Proses `claude` baru di-spawn saat prompt pertama (`sessionId` ini).
        const id = randomUUID();
        getOrCreate(id, false);
        return { ok: true, data: { id, directory: cwd } };
      },
      async get(sessionId) {
        if (sessions.has(sessionId)) return { ok: true, data: { id: sessionId, directory: cwd } };
        if (await transcripts.exists(sessionId, cwd)) {
          getOrCreate(sessionId, true);
          return { ok: true, data: { id: sessionId, directory: cwd } };
        }
        return { ok: false, error: "SESSION_NOT_FOUND" };
      },
      remove,
      async switchModel(sessionId, model) {
        getOrCreate(sessionId, false).wantModel = selectedModel(model);
        return { ok: true };
      },
      // Claude Code memakai permission mode, bukan agent percakapan ala
      // opencode (lihat `setPermissionMode`).
      async switchAgent() {
        return { ok: true };
      },
      setPermissionMode,
      async instructions(sessionId, text) {
        getOrCreate(sessionId, false).wantSystem = text?.trim() ? text : null;
        return { ok: true };
      },
      prompt,
      interrupt,
      async todos(sessionId) {
        return { ok: true, data: sessions.get(sessionId)?.todos ?? [] };
      },
    },
    permission: {
      reply: ({ requestID, decision }) => replyPermission(requestID, decision),
    },
    form: {
      reply: ({ formID, answer }) => replyForm(formID, answer),
      async cancel({ formID }) {
        const ask = takePending(formID, "question") ?? takePending(formID, "plan");
        if (!ask) return { ok: false, error: AGENT_REQUEST_GONE };
        ask.resolve({
          behavior: "deny",
          message:
            ask.kind === "plan"
              ? "The user dismissed the plan. Keep planning."
              : "The user dismissed the question.",
        });
        return { ok: true };
      },
    },
    model: { list: listModels },
    agent: {
      async list() {
        return { ok: true, data: [] };
      },
    },
    mcp: { list: listMcp },
    skill: {
      async list() {
        try {
          return { ok: true, data: await listClaudeSkills(cwd, claudeGlobalSkillsDir(baseEnv)) };
        } catch (e) {
          return { ok: false, error: `CC_SKILLS_FAILED: ${(e as Error).message}` };
        }
      },
    },
    file: { find: findFiles },
    vcs: {
      async status() {
        return { ok: true, data: await gitFileStatus(cwd) };
      },
    },
    location: {
      async reload() {
        // Skill/config dibaca ulang tiap proses `claude` baru.
        modelsCache = null;
        return { ok: true };
      },
    },
    event: {
      subscribe(cb) {
        listeners.add(cb);
        return () => {
          listeners.delete(cb);
        };
      },
    },
    async close() {
      for (const live of sessions.values()) {
        dropPending(live.id, "Claude Code backend stopped.");
        closeQuery(live);
      }
    },
  };
}

export interface ClaudeBackendOptions {
  clientFactory?: (cwd: string) => ClaudeClient;
}

/**
 * Backend Claude Code — tanpa proses/port: hanya client in-process per
 * Project yang mengelola proses `claude` per Session.
 */
export function createClaudeBackend(opts: ClaudeBackendOptions = {}): AgentBackend {
  const factory = opts.clientFactory ?? ((cwd: string) => createClaudeClient(cwd));
  const clients = new Map<string, { client: ClaudeClient; cwd: string }>();

  async function release(projectId: string): Promise<void> {
    const cur = clients.get(projectId);
    if (!cur) return;
    clients.delete(projectId);
    await cur.client.close();
  }

  return {
    kind: "claude-code",
    async ensure(projectId, directory) {
      const cur = clients.get(projectId);
      if (cur && cur.cwd === directory) return { ok: true, data: cur.client };
      let isDir = false;
      try {
        isDir = existsSync(directory) && statSync(directory).isDirectory();
      } catch {
        isDir = false;
      }
      if (!isDir) return { ok: false, error: "PROJECT_DIR_NOT_FOUND" };
      if (cur) await cur.client.close();
      const client = factory(path.resolve(directory));
      clients.set(projectId, { client, cwd: directory });
      return { ok: true, data: client };
    },
    get: (projectId) => clients.get(projectId)?.client,
    release,
    async shutdown() {
      await Promise.all([...clients.keys()].map((id) => release(id)));
    },
    // Tidak ada proses server yang bisa hilang; crash proses `claude` per
    // Session dilaporkan sebagai `session.execution.failed`.
    onLost() {},
  };
}
