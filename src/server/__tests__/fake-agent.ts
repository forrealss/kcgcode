/**
 * Agent palsu untuk test (bukan file test): `AgentClient` + `AgentBackend`
 * dengan log panggilan, hasil yang bisa diatur, dan `emit` event agent.
 *
 * Log `calls` memakai nama API lapisan agent (`session.prompt:<teks>`,
 * `permission.reply:<id>:<decision>`, `form.reply:<id>:<jawaban>`, …).
 * Jawaban form dirender sebagai nilai per field dipisah `|`, nilai
 * multi-select dipisah `,`.
 */
import type {
  AgentOption,
  ContextUsage,
  FileChange,
  McpServerInfo,
  ModelOption,
  SkillInfo,
  SlashCommandInfo,
  TodoItem,
} from "../../types";
import {
  AGENT_REQUEST_GONE,
  type AgentBackend,
  type AgentClient,
  type AgentEvent,
  type AgentPromptFile,
} from "../agents/types";

type Res = { ok: boolean; error?: string };

export interface FakeAgentClient extends AgentClient {
  calls: string[];
  /** Kirim event agent ke subscriber. */
  emit(ev: AgentEvent): void;
  /** Ada subscriber event aktif. */
  readonly subscribed: boolean;
  createSessionResult: Res & { id?: string };
  getSessionResult: Res;
  listModelsResult: Res;
  deleteSessionResult: Res;
  findFilesResult: Res;
  promptResult: Res;
  /** Request permission/form yang sudah tidak ditunggu agent. */
  goneRequests: Set<string>;
  /** Jeda simulasi sebelum tiap prompt selesai (ms) — uji race. */
  promptDelays: number[];
  todos: TodoItem[];
  /** Pemakaian context window yang dilaporkan `session.contextUsage`. */
  usage: ContextUsage | null;
  fileChanges: FileChange[];
  availableFiles: string[];
  availableModels: ModelOption[];
  availableAgents: AgentOption[];
  mcpServers: McpServerInfo[];
  skillList: SkillInfo[];
  commandList: SlashCommandInfo[];
  /** Per prompt: lampiran, model (`provider/model` | null), agent, instruksi. */
  promptFilesCalls: AgentPromptFile[][];
  promptModels: (string | null)[];
  /** Thinking effort yang berlaku per prompt (null = default model). */
  promptEfforts: (string | null)[];
  promptAgents: (string | null)[];
  promptSystems: (string | null)[];
  /** Permission mode yang berlaku per prompt (null = default agent). */
  promptModes: (string | null)[];
  /** Hasil `setPermissionMode` (untuk mensimulasikan kegagalan). */
  permissionModeResult: Res;
  /** Hook setelah prompt diterima (mis. memancarkan balasan palsu). */
  onPrompt?: (sessionID: string, text: string) => void;
}

function render(answer: Record<string, unknown>): string {
  return Object.values(answer)
    .map((v) => (Array.isArray(v) ? v.join(",") : String(v)))
    .join("|");
}

export function makeFakeClient(overrides: Partial<FakeAgentClient> = {}): FakeAgentClient {
  const calls: string[] = [];
  let eventCb: ((ev: AgentEvent) => void) | null = null;
  /** Pilihan yang diterapkan per Session (switchModel/switchAgent/instructions). */
  const applied = new Map<
    string,
    {
      model: string | null;
      effort: string | null;
      agent: string | null;
      system: string | null;
      mode: string | null;
    }
  >();
  const appliedFor = (id: string) => {
    let a = applied.get(id);
    if (!a) {
      a = { model: null, effort: null, agent: null, system: null, mode: null };
      applied.set(id, a);
    }
    return a;
  };
  const fail = (r: Res, code: string) => ({ ok: false as const, error: r.error ?? code });

  const client: FakeAgentClient = {
    kind: "opencode",
    directory: "/proj",
    capabilities: { skillReload: true, permissionModes: [] },
    calls,
    get subscribed() {
      return eventCb !== null;
    },
    createSessionResult: { ok: true, id: "ses_remote1" },
    getSessionResult: { ok: true },
    listModelsResult: { ok: true },
    deleteSessionResult: { ok: true },
    findFilesResult: { ok: true },
    promptResult: { ok: true },
    goneRequests: new Set<string>(),
    promptDelays: [],
    todos: [],
    usage: null,
    fileChanges: [],
    availableFiles: [
      "src/App.tsx",
      "src/server/app.ts",
      "src/lib/api.ts",
      "src/components/sessions/SessionList.tsx",
    ],
    availableModels: [
      {
        providerID: "kcgcode",
        providerName: "kcgcode",
        modelID: "kiro/claude-opus-5",
        name: "Claude Opus 5",
      },
    ],
    availableAgents: [
      { name: "build", mode: "primary", description: "Full tool access" },
      { name: "plan", mode: "primary", description: "Planning only" },
    ],
    mcpServers: [
      { name: "context7", status: "connected", error: null },
      { name: "broken", status: "failed", error: "spawn ENOENT" },
    ],
    skillList: [{ name: "shadcn", description: "UI", location: null, source: "project" }],
    commandList: [{ name: "review", description: "Review changes", argumentHint: "[pr#]" }],
    promptFilesCalls: [],
    promptModels: [],
    promptEfforts: [],
    promptAgents: [],
    promptSystems: [],
    promptModes: [],
    permissionModeResult: { ok: true },
    session: {
      async create(input) {
        calls.push(`session.create:${input?.title ?? ""}`);
        if (!client.createSessionResult.ok) {
          return fail(client.createSessionResult, "AGENT_CREATE_SESSION_FAILED");
        }
        return {
          ok: true,
          data: { id: client.createSessionResult.id ?? "ses_remote1", directory: "/proj" },
        };
      },
      async get(sessionID) {
        calls.push(`session.get:${sessionID}`);
        if (!client.getSessionResult.ok)
          return fail(client.getSessionResult, "AGENT_SESSION_NOT_FOUND");
        return { ok: true, data: { id: sessionID } };
      },
      async remove(sessionID) {
        calls.push(`session.remove:${sessionID}`);
        if (!client.deleteSessionResult.ok) {
          return fail(client.deleteSessionResult, "AGENT_DELETE_SESSION_FAILED");
        }
        return { ok: true };
      },
      async switchModel(sessionID, model, effort = null) {
        const a = appliedFor(sessionID);
        a.model = model ? `${model.providerID}/${model.modelID}` : null;
        a.effort = effort;
        return { ok: true };
      },
      async switchAgent(sessionID, agent) {
        appliedFor(sessionID).agent = agent;
        return { ok: true };
      },
      async instructions(sessionID, text) {
        appliedFor(sessionID).system = text?.trim() ? text : null;
        return { ok: true };
      },
      async prompt({ sessionID, text, files }) {
        calls.push(`session.prompt:${text}`);
        const a = appliedFor(sessionID);
        client.promptFilesCalls.push(files ?? []);
        client.promptModels.push(a.model);
        client.promptEfforts.push(a.effort);
        client.promptAgents.push(a.agent);
        client.promptSystems.push(a.system);
        client.promptModes.push(a.mode);
        const delay = client.promptDelays.shift();
        if (delay) await Bun.sleep(delay);
        if (!client.promptResult.ok) return fail(client.promptResult, "AGENT_PROMPT_FAILED");
        client.onPrompt?.(sessionID, text);
        return { ok: true };
      },
      async interrupt(sessionID) {
        calls.push(`session.interrupt:${sessionID}`);
        return { ok: true };
      },
      async setPermissionMode(sessionID, mode) {
        calls.push(`session.permission_mode:${sessionID}:${mode}`);
        if (mode !== null && client.capabilities.permissionModes.length === 0) {
          return { ok: false, error: "AGENT_PERMISSION_MODE_UNSUPPORTED" };
        }
        if (!client.permissionModeResult.ok) {
          return fail(client.permissionModeResult, "AGENT_PERMISSION_MODE_FAILED");
        }
        appliedFor(sessionID).mode = mode;
        return { ok: true };
      },
      async todos(sessionID) {
        calls.push(`session.todos:${sessionID}`);
        return { ok: true, data: client.todos };
      },
      async contextUsage() {
        return { ok: true, data: client.usage };
      },
    },
    permission: {
      async reply({ requestID, decision }) {
        calls.push(`permission.reply:${requestID}:${decision}`);
        if (client.goneRequests.has(requestID)) return { ok: false, error: AGENT_REQUEST_GONE };
        return { ok: true };
      },
    },
    form: {
      async reply({ formID, answer }) {
        calls.push(`form.reply:${formID}:${render(answer)}`);
        if (client.goneRequests.has(formID)) return { ok: false, error: AGENT_REQUEST_GONE };
        return { ok: true };
      },
      async cancel({ formID }) {
        calls.push(`form.cancel:${formID}`);
        if (client.goneRequests.has(formID)) return { ok: false, error: AGENT_REQUEST_GONE };
        return { ok: true };
      },
    },
    model: {
      async list() {
        calls.push("model.list");
        if (!client.listModelsResult.ok)
          return fail(client.listModelsResult, "AGENT_LIST_MODELS_FAILED");
        return { ok: true, data: client.availableModels };
      },
    },
    agent: {
      async list() {
        calls.push("agent.list");
        return { ok: true, data: client.availableAgents };
      },
    },
    mcp: {
      async list() {
        calls.push("mcp.list");
        return { ok: true, data: client.mcpServers };
      },
    },
    skill: {
      async list() {
        calls.push("skill.list");
        return { ok: true, data: client.skillList };
      },
    },
    command: {
      async list() {
        calls.push("command.list");
        return { ok: true, data: client.commandList };
      },
    },
    file: {
      async find(query) {
        calls.push(`file.find:${query}`);
        if (!client.findFilesResult.ok)
          return fail(client.findFilesResult, "AGENT_FIND_FILES_FAILED");
        return { ok: true, data: client.availableFiles.filter((f) => f.includes(query)) };
      },
    },
    vcs: {
      async status() {
        calls.push("vcs.status");
        return { ok: true, data: client.fileChanges };
      },
    },
    location: {
      async reload() {
        calls.push("location.reload");
        return { ok: true };
      },
    },
    event: {
      subscribe(cb) {
        eventCb = cb;
        return () => {
          if (eventCb === cb) eventCb = null;
        };
      },
    },
    emit(ev) {
      eventCb?.(ev);
    },
    ...overrides,
  };
  return client;
}

export interface FakeBackend {
  backend: AgentBackend;
  clients: Map<string, FakeAgentClient>;
  ensureCalls: { projectId: string; directory: string }[];
  ensureResult: Res;
  /** Project yang dilepas (`release`/`shutdown`). */
  released: string[];
  /** Picu `onLost` (agent hilang tak terduga) untuk Project. */
  lose(projectId: string): void;
}

export function makeFakeBackend(
  kind: AgentBackend["kind"] = "opencode",
  factory: (projectId: string) => FakeAgentClient = () => makeFakeClient(),
): FakeBackend {
  const clients = new Map<string, FakeAgentClient>();
  const lostCbs = new Set<(projectId: string) => void>();
  const state: FakeBackend = {
    clients,
    ensureCalls: [],
    ensureResult: { ok: true },
    released: [],
    lose(projectId) {
      for (const cb of lostCbs) cb(projectId);
    },
    backend: {
      kind,
      async ensure(projectId, directory) {
        state.ensureCalls.push({ projectId, directory });
        if (!state.ensureResult.ok) {
          return { ok: false, error: state.ensureResult.error ?? "SERVER_START_FAILED" };
        }
        let client = clients.get(projectId);
        if (!client) {
          client = factory(projectId);
          clients.set(projectId, client);
        }
        return { ok: true, data: client };
      },
      get: (projectId) => clients.get(projectId),
      async release(projectId) {
        state.released.push(projectId);
        clients.delete(projectId);
      },
      async shutdown() {
        for (const id of [...clients.keys()]) state.released.push(id);
        clients.clear();
      },
      onLost(cb) {
        lostCbs.add(cb);
      },
    },
  };
  return state;
}

/** Balasan teks lengkap satu turn (step + teks + selesai) untuk Session agent. */
export function replyEvents(sessionID: string, messageID: string, text: string): AgentEvent[] {
  const base = { sessionID, assistantMessageID: messageID };
  return [
    { type: "session.execution.started", data: { sessionID } },
    { type: "session.step.started", data: base },
    { type: "session.text.started", data: { ...base, ordinal: 0 } },
    { type: "session.text.ended", data: { ...base, ordinal: 0, text } },
    { type: "session.step.ended", data: { ...base, finish: "stop" } },
    { type: "session.execution.succeeded", data: { sessionID } },
  ];
}
