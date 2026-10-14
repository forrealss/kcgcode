/**
 * Backend opencode v2 — `@opencode/client` + background service resmi.
 *
 * - SATU service opencode (`Service.ensure()` -> `opencode serve --service`,
 *   dipakai bersama aplikasi opencode lain milik user) melayani seluruh
 *   Project: Session v2 terikat `location.directory`, jadi tidak ada lagi
 *   server per Project, parsing port, atau health check manual.
 * - Satu langganan event untuk semua Project; tiap event dirutekan ke client
 *   Project berdasarkan direktori Session-nya.
 * - Langganan v2 bersifat live-only tanpa reconnect otomatis: bila putus,
 *   service di-ensure ulang. Bila service-nya berganti (pid berbeda) turn
 *   yang berjalan hilang -> `onLost` untuk tiap Project.
 * - Client per Project stabil selama backend hidup (tidak diganti saat
 *   reconnect), sehingga langganan Session_Manager tetap menempel.
 */
import path from "node:path";
import { OpenCode } from "@opencode/client";
import { Service } from "@opencode/client/service";
import type {
  AgentOption,
  FileChange,
  McpServerInfo,
  ModelOption,
  SkillInfo,
  SlashCommandInfo,
  TodoItem,
} from "../../../types";
import type { Result, SimpleResult } from "../../result";
import {
  AGENT_REQUEST_GONE,
  type AgentBackend,
  type AgentClient,
  type AgentEvent,
  type ModelSelection,
} from "../types";
import { translateOpencodeEvent } from "./translate";
import { checkOpencodeVersion, OPENCODE_MIN_MAJOR, type VersionProbe } from "./version";

/** Subset API `@opencode/client` yang dipakai (di-mock pada test). */
export interface OpencodeApi {
  server: { info(): Promise<unknown> };
  session: {
    create(input: Record<string, unknown>): Promise<unknown>;
    get(input: { sessionID: string }): Promise<unknown>;
    remove(input: { sessionID: string }): Promise<unknown>;
    switchModel(input: Record<string, unknown>): Promise<unknown>;
    switchAgent(input: Record<string, unknown>): Promise<unknown>;
    prompt(input: Record<string, unknown>): Promise<unknown>;
    command(input: Record<string, unknown>): Promise<unknown>;
    interrupt(input: { sessionID: string }): Promise<unknown>;
    instructions: {
      entry: {
        put(input: Record<string, unknown>): Promise<unknown>;
        remove(input: Record<string, unknown>): Promise<unknown>;
      };
    };
    form: {
      reply(input: Record<string, unknown>): Promise<unknown>;
      cancel(input: Record<string, unknown>): Promise<unknown>;
    };
  };
  permission: { reply(input: Record<string, unknown>): Promise<unknown> };
  model: {
    list(input: Record<string, unknown>): Promise<unknown>;
    default(input: Record<string, unknown>): Promise<unknown>;
  };
  provider: { list(input: Record<string, unknown>): Promise<unknown> };
  agent: { list(input: Record<string, unknown>): Promise<unknown> };
  mcp: { list(input: Record<string, unknown>): Promise<unknown> };
  skill: { list(input: Record<string, unknown>): Promise<unknown> };
  command: { list(input: Record<string, unknown>): Promise<unknown> };
  file: { find(input: Record<string, unknown>): Promise<unknown> };
  vcs: { status(input: Record<string, unknown>): Promise<unknown> };
  location: { reload(input: Record<string, unknown>): Promise<unknown> };
  event: {
    subscribe(input?: undefined, options?: { signal?: AbortSignal }): AsyncIterable<unknown>;
  };
}

/** Koneksi ke service opencode (di-mock pada test). */
export type OpencodeConnector = () => Promise<OpencodeApi>;

/** Default: temukan/jalankan background service opencode v2 lalu buat client. */
export const defaultConnector: OpencodeConnector = async () => {
  const endpoint = await Service.ensure({
    version: (v: string) => Number.parseInt(v, 10) >= OPENCODE_MIN_MAJOR,
  });
  return OpenCode.make({
    baseUrl: endpoint.url,
    headers: Service.headers(endpoint),
  }) as unknown as OpencodeApi;
};

export interface OpencodeBackendOptions {
  connect?: OpencodeConnector;
  versionProbe?: VersionProbe;
  /** Jeda awal reconnect (ms); berlipat sampai `maxReconnectDelayMs`. */
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
}

/** Kunci instruksi Project yang dipasang KCG pada Session opencode. */
export const INSTRUCTIONS_KEY = "kcg-project";

/** Umur cache nama slash command (rute prompt `/nama`) per Project. */
const COMMANDS_CACHE_MS = 60_000;

/** `/nama args` di awal teks -> nama + argumen; selain itu null. */
export function parseSlashCommand(text: string): { name: string; args: string } | null {
  const m = /^\/([^\s/][^\s]*)(?:\s+([\s\S]*))?$/.exec(text.trim());
  return m ? { name: m[1] as string, args: (m[2] ?? "").trim() } : null;
}

/** Nama tool task list opencode. */
const TODO_TOOL = "todowrite";

type Rec = Record<string, unknown>;

function rec(v: unknown): Rec {
  return typeof v === "object" && v !== null ? (v as Rec) : {};
}

function list(v: unknown): unknown[] {
  const data = rec(v).data;
  return Array.isArray(data) ? data : Array.isArray(v) ? v : [];
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/** Kunci perbandingan direktori (Windows tidak case-sensitive). */
export function directoryKey(dir: string): string {
  const resolved = path.resolve(dir);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** Nama error tag client v2 (`SessionNotFoundError`, …). */
function errorName(e: unknown): string {
  const err = e as { _tag?: unknown; name?: unknown };
  return typeof err?._tag === "string" ? err._tag : typeof err?.name === "string" ? err.name : "";
}

function errorMessage(e: unknown): string {
  return (e as Error)?.message ?? String(e);
}

const GONE_ERRORS = new Set([
  "SessionNotFoundError",
  "PermissionNotFoundError",
  "FormNotFoundError",
  "FormAlreadySettledError",
]);

const MCP_STATUSES = new Set<McpServerInfo["status"]>([
  "connected",
  "disabled",
  "failed",
  "needs_auth",
  "needs_client_registration",
]);

/** Task list dari input tool `todowrite` (`{ todos: [...] }`). */
export function todosFromInput(input: unknown): TodoItem[] | null {
  const raw = rec(input).todos;
  if (!Array.isArray(raw)) return null;
  const out: TodoItem[] = [];
  for (const t of raw) {
    const item = rec(t);
    if (typeof item.content !== "string") continue;
    out.push({
      content: item.content,
      status: typeof item.status === "string" ? item.status : "pending",
      priority: typeof item.priority === "string" ? item.priority : "medium",
    });
  }
  return out;
}

export function createOpencodeBackend(opts: OpencodeBackendOptions = {}): AgentBackend {
  const connector = opts.connect ?? defaultConnector;
  const baseDelay = opts.reconnectDelayMs ?? 1000;
  const maxDelay = opts.maxReconnectDelayMs ?? 30_000;

  /** Koneksi aktif (dibuat malas); null = belum/terputus. */
  let conn: Promise<Result<{ api: OpencodeApi; pid: unknown }>> | null = null;
  let stopped = false;
  let abort: AbortController | null = null;
  let reconnecting = false;

  /** Client per Project. */
  const clients = new Map<string, { client: AgentClient; dirKey: string }>();
  /** Listener event per kunci direktori. */
  const listeners = new Map<string, Set<(ev: AgentEvent) => void>>();
  /** Session opencode -> kunci direktori (untuk event tanpa `location`). */
  const sessionDirs = new Map<string, string>();
  /** Task list terakhir per Session opencode. */
  const todos = new Map<string, TodoItem[]>();
  /** Tool call `todowrite` yang sedang berjalan. */
  const todoCalls = new Set<string>();
  const lostCbs = new Set<(projectId: string) => void>();

  function notifyLost(): void {
    for (const projectId of clients.keys()) {
      for (const cb of lostCbs) cb(projectId);
    }
  }

  function emit(dirKey: string, ev: AgentEvent): void {
    for (const cb of listeners.get(dirKey) ?? []) {
      try {
        cb(ev);
      } catch (e) {
        console.warn("[kcg-code] handler event opencode gagal:", e);
      }
    }
  }

  function dispatch(raw: unknown): void {
    const ev = translateOpencodeEvent(raw);
    if (!ev) return;
    const sessionID =
      ev.type === "form.created"
        ? ev.data.form.sessionID
        : (ev.data as { sessionID: string }).sessionID;
    if (ev.location) sessionDirs.set(sessionID, directoryKey(ev.location.directory));
    const dirKey = sessionDirs.get(sessionID);
    if (!dirKey) return; // Session milik aplikasi opencode lain / belum dikenal.
    emit(dirKey, ev);
    // Task list opencode tidak punya endpoint v2: rakit dari tool `todowrite`.
    if (ev.type === "session.tool.input.started" && ev.data.name === TODO_TOOL) {
      todoCalls.add(ev.data.id);
    } else if (ev.type === "session.tool.called" && todoCalls.has(ev.data.id)) {
      todoCalls.delete(ev.data.id);
      const items = todosFromInput(ev.data.input);
      if (items) {
        todos.set(sessionID, items);
        emit(dirKey, { type: "agent.todos.updated", data: { sessionID, todos: items } });
      }
    }
  }

  async function pump(api: OpencodeApi, pid: unknown): Promise<void> {
    const ctrl = new AbortController();
    abort = ctrl;
    try {
      for await (const raw of api.event.subscribe(undefined, { signal: ctrl.signal })) {
        dispatch(raw);
      }
    } catch {
      // Stream putus — ditangani di bawah.
    }
    if (stopped || ctrl.signal.aborted) return;
    void reconnect(pid);
  }

  /** Sambung ulang setelah stream putus; backoff sampai berhasil. */
  async function reconnect(prevPid: unknown): Promise<void> {
    if (reconnecting) return;
    reconnecting = true;
    conn = null;
    let delay = baseDelay;
    let lostNotified = false;
    try {
      while (!stopped) {
        await Bun.sleep(delay);
        if (stopped) return;
        const res = await connect();
        if (res.ok) {
          // Service berganti: turn yang berjalan di service lama hilang.
          if (!lostNotified && res.data.pid !== prevPid) notifyLost();
          return;
        }
        if (!lostNotified) {
          lostNotified = true;
          notifyLost();
        }
        delay = Math.min(delay * 2, maxDelay);
      }
    } finally {
      reconnecting = false;
    }
  }

  function connect(): Promise<Result<{ api: OpencodeApi; pid: unknown }>> {
    if (!conn) {
      const attempt = (async (): Promise<Result<{ api: OpencodeApi; pid: unknown }>> => {
        const version = await checkOpencodeVersion(opts.versionProbe);
        if (!version.ok) return version;
        try {
          const api = await connector();
          const info = rec(await api.server.info());
          void pump(api, info.pid);
          return { ok: true, data: { api, pid: info.pid } };
        } catch (e) {
          return { ok: false, error: `SERVER_START_FAILED: ${errorMessage(e)}` };
        }
      })();
      conn = attempt;
      // Gagal -> izinkan percobaan berikutnya (mis. user baru meng-upgrade).
      void attempt.then((r) => {
        if (!r.ok && conn === attempt) conn = null;
      });
    }
    return conn;
  }

  async function api(): Promise<OpencodeApi> {
    const res = await connect();
    if (!res.ok) throw new Error(res.error);
    return res.data.api;
  }

  /** Jalankan panggilan API; error -> `Result` gagal dengan prefiks `code`. */
  async function call<T>(code: string, fn: (a: OpencodeApi) => Promise<T>): Promise<Result<T>> {
    try {
      return { ok: true, data: await fn(await api()) };
    } catch (e) {
      return { ok: false, error: `${code}: ${errorMessage(e)}` };
    }
  }

  /** Seperti `call` untuk reply: request yang sudah tidak ditunggu -> GONE. */
  async function reply(
    code: string,
    fn: (a: OpencodeApi) => Promise<unknown>,
  ): Promise<SimpleResult> {
    try {
      await fn(await api());
      return { ok: true };
    } catch (e) {
      if (GONE_ERRORS.has(errorName(e))) return { ok: false, error: AGENT_REQUEST_GONE };
      return { ok: false, error: `${code}: ${errorMessage(e)}` };
    }
  }

  function createClient(directory: string): AgentClient {
    const dirKey = directoryKey(directory);
    const location = { location: { directory } };
    /** Pilihan terakhir yang sudah diterapkan per Session (hindari RPC berulang). */
    const applied = new Map<
      string,
      { model?: string; effort?: string; agent?: string; instructions?: string | null }
    >();
    const appliedFor = (sessionID: string) => {
      let a = applied.get(sessionID);
      if (!a) {
        a = {};
        applied.set(sessionID, a);
      }
      return a;
    };

    const ok = <T>(r: Result<T>): SimpleResult =>
      r.ok ? { ok: true } : { ok: false, error: r.error };
    /** Slash command terakhir (untuk merutekan prompt `/nama`). */
    let commandsCache: { at: number; names: Set<string> } | null = null;

    async function listCommands(): Promise<Result<SlashCommandInfo[]>> {
      const res = await call("AGENT_LIST_COMMANDS_FAILED", (a) => a.command.list(location));
      if (!res.ok) return res;
      const out: SlashCommandInfo[] = [];
      for (const raw of list(res.data)) {
        const c = rec(raw);
        const name = str(c.name);
        if (!name) continue;
        out.push({ name, description: str(c.description), argumentHint: null });
      }
      out.sort((x, y) => x.name.localeCompare(y.name));
      commandsCache = { at: Date.now(), names: new Set(out.map((c) => c.name)) };
      return { ok: true, data: out };
    }

    /** Nama `/nama` dikenal opencode? Daftar gagal dimuat -> dianggap teks biasa. */
    async function isCommand(name: string): Promise<boolean> {
      if (!commandsCache || Date.now() - commandsCache.at > COMMANDS_CACHE_MS) {
        await listCommands();
      }
      return commandsCache?.names.has(name) ?? false;
    }

    const client: AgentClient = {
      kind: "opencode",
      directory,
      capabilities: { skillReload: true, permissionModes: [] },
      session: {
        async create(input = {}) {
          const res = await call("AGENT_CREATE_SESSION_FAILED", (a) =>
            a.session.create({ ...location, ...(input.title ? { title: input.title } : {}) }),
          );
          if (!res.ok) return res;
          const info = rec(res.data);
          const id = str(info.id);
          if (!id) return { ok: false, error: "AGENT_CREATE_SESSION_FAILED" };
          sessionDirs.set(id, dirKey);
          return { ok: true, data: { id, title: str(info.title) ?? undefined, directory } };
        },
        async get(sessionID) {
          try {
            const info = rec(await (await api()).session.get({ sessionID }));
            const dir = str(rec(info.location).directory);
            sessionDirs.set(sessionID, dir ? directoryKey(dir) : dirKey);
            return {
              ok: true,
              data: { id: sessionID, title: str(info.title) ?? undefined, directory },
            };
          } catch (e) {
            return { ok: false, error: `AGENT_SESSION_NOT_FOUND: ${errorMessage(e)}` };
          }
        },
        async remove(sessionID) {
          applied.delete(sessionID);
          todos.delete(sessionID);
          const res = await reply("AGENT_DELETE_SESSION_FAILED", (a) =>
            a.session.remove({ sessionID }),
          );
          // Session sudah tidak ada = tujuan tercapai.
          return res.ok || res.error === AGENT_REQUEST_GONE ? { ok: true } : res;
        },
        async switchModel(sessionID, model: ModelSelection | null, effort = null) {
          const a = appliedFor(sessionID);
          const want = model ? `${model.providerID}/${model.modelID}` : undefined;
          const wantEffort = effort ?? undefined;
          // `null` tanpa effort = default: hanya perlu kembali bila sebelumnya diganti.
          if (a.model === want && a.effort === wantEffort) return { ok: true };
          let ref: Rec;
          if (model) {
            ref = { id: model.modelID, providerID: model.providerID };
          } else {
            const def = await call("AGENT_SWITCH_MODEL_FAILED", (x) => x.model.default(location));
            if (!def.ok) return def;
            const info = rec(rec(def.data).data);
            ref = { id: info.id, providerID: info.providerID };
          }
          // Thinking effort opencode = variant model (`ModelRef.variant`).
          const res = await call("AGENT_SWITCH_MODEL_FAILED", (x) =>
            x.session.switchModel({
              sessionID,
              model: { ...ref, ...(wantEffort ? { variant: wantEffort } : {}) },
            }),
          );
          if (res.ok) {
            a.model = want;
            a.effort = wantEffort;
          }
          return ok(res);
        },
        async switchAgent(sessionID, agent) {
          const a = appliedFor(sessionID);
          const want = agent ?? undefined;
          if (a.agent === want) return { ok: true };
          let target = agent;
          if (!target) {
            if (a.agent === undefined) return { ok: true };
            const agents = await client.agent.list();
            target = agents.ok ? (agents.data[0]?.name ?? null) : null;
            if (!target) return { ok: false, error: "AGENT_SWITCH_AGENT_FAILED" };
          }
          const res = await call("AGENT_SWITCH_AGENT_FAILED", (x) =>
            x.session.switchAgent({ sessionID, agent: target }),
          );
          if (res.ok) a.agent = want;
          return ok(res);
        },
        async instructions(sessionID, text) {
          const a = appliedFor(sessionID);
          const want = text?.trim() ? text : null;
          if (a.instructions === want || (a.instructions === undefined && want === null)) {
            return { ok: true };
          }
          const res = await reply("AGENT_INSTRUCTIONS_FAILED", (x) =>
            want === null
              ? x.session.instructions.entry.remove({ sessionID, key: INSTRUCTIONS_KEY })
              : x.session.instructions.entry.put({ sessionID, key: INSTRUCTIONS_KEY, value: want }),
          );
          if (res.ok || (want === null && res.error === AGENT_REQUEST_GONE)) {
            a.instructions = want;
            return { ok: true };
          }
          return res;
        },
        async prompt(input) {
          sessionDirs.set(input.sessionID, dirKey);
          const files = input.files?.length
            ? { files: input.files.map((f) => ({ uri: f.uri, name: f.name })) }
            : {};
          // `/nama args` milik opencode dijalankan lewat `session.command`
          // (TUI opencode melakukan hal yang sama); `/usr/bin …` dsb. tetap teks.
          const slash = parseSlashCommand(input.text);
          if (slash && (await isCommand(slash.name))) {
            const res = await call("AGENT_PROMPT_FAILED", (a) =>
              a.session.command({
                sessionID: input.sessionID,
                name: slash.name,
                text: slash.args,
                ...files,
              }),
            );
            return ok(res);
          }
          const res = await call("AGENT_PROMPT_FAILED", (a) =>
            a.session.prompt({ sessionID: input.sessionID, text: input.text, ...files }),
          );
          return ok(res);
        },
        async interrupt(sessionID) {
          return ok(await call("AGENT_ABORT_FAILED", (a) => a.session.interrupt({ sessionID })));
        },
        // opencode v2 tidak punya permission mode tingkat Session (izin diatur
        // lewat agent & config) — hanya `null` (tanpa pilihan) yang diterima.
        async setPermissionMode(_sessionID, mode) {
          return mode === null
            ? { ok: true }
            : { ok: false, error: "AGENT_PERMISSION_MODE_UNSUPPORTED" };
        },
        async todos(sessionID) {
          return { ok: true, data: todos.get(sessionID) ?? [] };
        },
      },
      permission: {
        reply: ({ sessionID, requestID, decision }) =>
          reply("AGENT_PERMISSION_REPLY_FAILED", (a) =>
            a.permission.reply({ sessionID, requestID, decision }),
          ),
      },
      form: {
        reply: ({ sessionID, formID, answer }) =>
          reply("AGENT_FORM_REPLY_FAILED", (a) =>
            a.session.form.reply({ sessionID, formID, answer }),
          ),
        cancel: ({ sessionID, formID }) =>
          reply("AGENT_FORM_CANCEL_FAILED", (a) => a.session.form.cancel({ sessionID, formID })),
      },
      model: {
        async list() {
          const res = await call("AGENT_LIST_MODELS_FAILED", (a) =>
            Promise.all([
              a.model.list(location),
              a.provider.list(location).catch(() => null),
              a.model.default(location).catch(() => null),
            ]),
          );
          if (!res.ok) return res;
          const [models, providers, fallback] = res.data;
          const def = rec(rec(fallback).data);
          const names = new Map<string, string>();
          for (const p of list(providers)) {
            const id = str(rec(p).id);
            if (id) names.set(id, str(rec(p).name) ?? id);
          }
          const out: ModelOption[] = [];
          for (const raw of list(models)) {
            const m = rec(raw);
            const id = str(m.id);
            const providerID = str(m.providerID);
            if (!id || !providerID) continue;
            if (m.enabled === false || m.status === "deprecated") continue;
            const efforts = (Array.isArray(m.variants) ? m.variants : [])
              .map((v) => str(rec(v).id))
              .filter((v): v is string => v !== null);
            out.push({
              providerID,
              providerName: names.get(providerID) ?? providerID,
              modelID: id,
              name: str(m.name) ?? id,
              ...(efforts.length > 0 ? { efforts } : {}),
              ...(def.id === id && def.providerID === providerID ? { isDefault: true } : {}),
            });
          }
          return { ok: true, data: out };
        },
      },
      agent: {
        async list() {
          const res = await call("AGENT_LIST_AGENTS_FAILED", (a) => a.agent.list(location));
          if (!res.ok) return res;
          const out: AgentOption[] = [];
          for (const raw of list(res.data)) {
            const ag = rec(raw);
            const id = str(ag.id);
            // Subagent murni & agent tersembunyi bukan mode percakapan.
            if (!id || ag.mode === "subagent" || ag.hidden === true) continue;
            out.push({
              name: id,
              mode: ag.mode === "all" ? "all" : "primary",
              description: str(ag.description),
            });
          }
          return { ok: true, data: out };
        },
      },
      mcp: {
        async list() {
          const res = await call("AGENT_LIST_MCP_FAILED", (a) => a.mcp.list(location));
          if (!res.ok) return res;
          const out: McpServerInfo[] = [];
          for (const raw of list(res.data)) {
            const m = rec(raw);
            const name = str(m.name);
            if (!name) continue;
            const st = rec(m.status);
            const status = MCP_STATUSES.has(st.status as McpServerInfo["status"])
              ? (st.status as McpServerInfo["status"])
              : "unknown";
            out.push({ name, status, error: str(st.error) });
          }
          return { ok: true, data: out.sort((x, y) => x.name.localeCompare(y.name)) };
        },
      },
      skill: {
        async list() {
          const res = await call("AGENT_LIST_SKILLS_FAILED", (a) => a.skill.list(location));
          if (!res.ok) return res;
          const root = directoryKey(directory);
          const out: SkillInfo[] = [];
          for (const raw of list(res.data)) {
            const s = rec(raw);
            const name = str(s.id) ?? str(s.name);
            if (!name) continue;
            const loc = str(s.path);
            const builtin = loc === null || loc.startsWith("/builtin/");
            const key = loc ? directoryKey(loc) : "";
            const source = builtin
              ? "builtin"
              : key === root || key.startsWith(root + path.sep)
                ? "project"
                : "global";
            out.push({
              name,
              description: str(s.description),
              location: builtin ? null : loc,
              source,
            });
          }
          return { ok: true, data: out.sort((x, y) => x.name.localeCompare(y.name)) };
        },
      },
      command: { list: listCommands },
      file: {
        async find(query) {
          const res = await call("AGENT_FIND_FILES_FAILED", (a) =>
            a.file.find({ ...location, query, type: "file", limit: 50 }),
          );
          if (!res.ok) return res;
          const out: string[] = [];
          for (const raw of list(res.data)) {
            const p = str(rec(raw).path);
            if (p) out.push(p);
          }
          return { ok: true, data: out };
        },
      },
      vcs: {
        async status() {
          const res = await call("AGENT_FILE_STATUS_FAILED", (a) => a.vcs.status(location));
          if (!res.ok) return res;
          const out: FileChange[] = [];
          for (const raw of list(res.data)) {
            const f = rec(raw);
            const file = str(f.file);
            if (!file) continue;
            const status = f.status === "added" || f.status === "deleted" ? f.status : "modified";
            out.push({
              path: file,
              added: typeof f.additions === "number" ? f.additions : 0,
              removed: typeof f.deletions === "number" ? f.deletions : 0,
              status,
            });
          }
          return { ok: true, data: out };
        },
      },
      location: {
        async reload() {
          return ok(await call("AGENT_RELOAD_FAILED", (a) => a.location.reload(location)));
        },
      },
      event: {
        subscribe(cb) {
          let set = listeners.get(dirKey);
          if (!set) {
            set = new Set();
            listeners.set(dirKey, set);
          }
          set.add(cb);
          return () => {
            set?.delete(cb);
          };
        },
      },
    };
    return client;
  }

  return {
    kind: "opencode",
    async ensure(projectId, directory) {
      const res = await connect();
      if (!res.ok) return { ok: false, error: res.error };
      const dirKey = directoryKey(directory);
      const cur = clients.get(projectId);
      if (cur && cur.dirKey === dirKey) return { ok: true, data: cur.client };
      const client = createClient(path.resolve(directory));
      clients.set(projectId, { client, dirKey });
      return { ok: true, data: client };
    },
    get(projectId) {
      return clients.get(projectId)?.client;
    },
    async release(projectId) {
      clients.delete(projectId);
    },
    async shutdown() {
      // Service opencode milik user (dipakai bersama aplikasi lain) tidak
      // dimatikan — cukup lepas langganan event.
      stopped = true;
      abort?.abort();
      clients.clear();
    },
    onLost(cb) {
      lostCbs.add(cb);
    },
  };
}
