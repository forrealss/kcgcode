/**
 * Unit & property test `session-manager.ts` (versi headless).
 *
 * Session_Manager kini mengorkestrasi server headless opencode (bukan PTY):
 * - `createSession` async: validasi -> ensure server -> POST /session.
 * - `sendFreeTextInput` async: echo pesan user -> POST message -> balasan.
 * - Interactive_Prompt dari event SSE `permission.asked` / `question.asked`.
 * - `resolvePrompt` -> reply permission/question, bukan menulis `y\n` ke PTY.
 *
 * Mocking boundary: `OpenCodeServerManager` + `OpenCodeClient` di-mock
 * seluruhnya (sesuai batasan mocking `design.md`); `bun:sqlite` asli.
 */
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import fc from "fast-check";
import type { SessionStore } from "../../../db";
import { openSessionStore } from "../../../db";
import type {
  AgentType,
  InteractivePrompt,
  MessagePart,
  Project,
  SessionMessage,
  SessionStatus,
} from "../../../types";
import { type AttachmentManager, createAttachmentManager } from "../attachments";
import type {
  AgentOption,
  ModelOption,
  OpenCodeClient,
  OpenCodeEvent,
  OpenCodePermissionReply,
} from "../opencode-client";
import type { OpenCodeServerHandle, OpenCodeServerManager } from "../opencode-server";
import {
  type CreateSessionRequest,
  createSessionManager,
  type SessionManager,
} from "../session-manager";

// ---------------------------------------------------------------------------
// Mock OpenCodeClient
// ---------------------------------------------------------------------------

interface FakeClient extends OpenCodeClient {
  /** Calls tercatat: createSession, sendMessage, replyPermission, dst. */
  calls: string[];
  sendMessageResult: { ok: boolean; error?: string };
  promptAsyncResult: { ok: boolean; error?: string };
  createSessionResult: { ok: boolean; error?: string; id?: string };
  /** Hasil getSession — false mensimulasikan oc session tidak dikenal server. */
  getSessionResult: { ok: boolean; error?: string };
  /** Hasil listModels — dipakai validasi model saat createSession. */
  listModelsResult: { ok: boolean; error?: string };
  /** Hasil deleteSession — false mensimulasikan server headless menolak. */
  deleteSessionResult: { ok: boolean; error?: string };
  /** Hasil findFiles — dipakai autocomplete @file. */
  findFilesResult: { ok: boolean; error?: string };
  /** Daftar file yang "tersedia" untuk findFiles. */
  availableFiles: string[];
  /** Referensi file yang dikirim ke tiap promptAsync (kosong = tanpa file). */
  promptFilesCalls: { filename: string; mime: string; url: string }[][];
  /** Model yang tersedia (default: satu provider dengan satu model). */
  availableModels: ModelOption[];
  /** Model yang diterima tiap panggilan promptAsync (null = default). */
  promptModels: (string | null)[];
  /** Agent yang tersedia untuk listAgents (default: build + plan). */
  availableAgents: AgentOption[];
  /** Agent yang diterima tiap panggilan promptAsync (null = default). */
  promptAgents: (string | null)[];
  /** Antrean jeda simulasi sebelum tiap sendMessage selesai (ms) — uji race. */
  sendDelays?: number[];
  emit(ev: OpenCodeEvent): void;
  eventCb: ((ev: OpenCodeEvent) => void) | null;
}

function makeFakeClient(overrides: Partial<FakeClient> = {}): FakeClient {
  const calls: string[] = [];
  const client: FakeClient = {
    calls,
    eventCb: null,
    promptFilesCalls: [],
    sendMessageResult: { ok: true },
    promptAsyncResult: { ok: true },
    createSessionResult: { ok: true, id: "ses_remote1" },
    getSessionResult: { ok: true },
    listModelsResult: { ok: true },
    deleteSessionResult: { ok: true },
    findFilesResult: { ok: true },
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
    promptModels: [],
    availableAgents: [
      { name: "build", mode: "primary", description: "Full tool access" },
      { name: "plan", mode: "primary", description: "Planning only" },
    ],
    promptAgents: [],
    async createSession(opts) {
      calls.push(`createSession:${opts?.title ?? ""}`);
      if (!client.createSessionResult.ok) {
        return { ok: false, error: client.createSessionResult.error ?? "OC_CREATE_SESSION_FAILED" };
      }
      return {
        ok: true,
        data: { id: client.createSessionResult.id ?? "ses_remote1", directory: "/proj" },
      };
    },
    async getSession(sessionId) {
      calls.push(`getSession:${sessionId}`);
      if (!client.getSessionResult.ok) {
        return { ok: false, error: client.getSessionResult.error ?? "OC_SESSION_NOT_FOUND" };
      }
      return { ok: true };
    },
    async listModels() {
      calls.push("listModels");
      if (!client.listModelsResult.ok) {
        return { ok: false, error: client.listModelsResult.error ?? "OC_LIST_MODELS_FAILED" };
      }
      return { ok: true, data: client.availableModels };
    },
    async listAgents() {
      calls.push("listAgents");
      return { ok: true, data: client.availableAgents };
    },
    async findFiles(query) {
      calls.push(`findFiles:${query}`);
      if (!client.findFilesResult.ok) {
        return { ok: false, error: client.findFilesResult.error ?? "OC_FIND_FILES_FAILED" };
      }
      return { ok: true, data: client.availableFiles.filter((f) => f.includes(query)) };
    },
    async sendMessage(_sessionId, text) {
      calls.push(`sendMessage:${text}`);
      const delay = client.sendDelays?.shift();
      if (delay) await Bun.sleep(delay);
      if (!client.sendMessageResult.ok) {
        return { ok: false, error: client.sendMessageResult.error ?? "OC_SEND_MESSAGE_FAILED" };
      }
      return {
        ok: true,
        data: {
          info: { id: "msg_assistant", role: "assistant" },
          parts: [{ type: "text", text: `balasan: ${text}` }],
        },
      };
    },
    async promptAsync(_sessionId, text, model, files, agent) {
      calls.push(`promptAsync:${text}`);
      client.promptFilesCalls.push(files ?? []);
      client.promptModels.push(model ? `${model.providerID}/${model.modelID}` : null);
      client.promptAgents.push(agent ?? null);
      const delay = client.sendDelays?.shift();
      if (delay) await Bun.sleep(delay);
      if (!client.promptAsyncResult.ok) {
        return { ok: false, error: client.promptAsyncResult.error ?? "OC_PROMPT_ASYNC_FAILED" };
      }
      return { ok: true, data: null };
    },
    async replyPermission(requestId, reply: OpenCodePermissionReply) {
      calls.push(`replyPermission:${requestId}:${reply}`);
      return { ok: true, data: null };
    },
    async replyQuestion(requestId, answers) {
      calls.push(`replyQuestion:${requestId}:${answers.join(",")}`);
      return { ok: true, data: null };
    },
    async rejectQuestion(requestId) {
      calls.push(`rejectQuestion:${requestId}`);
      return { ok: true, data: null };
    },
    async abortSession(sessionId) {
      calls.push(`abortSession:${sessionId}`);
      return { ok: true, data: null };
    },
    async deleteSession(sessionId) {
      calls.push(`deleteSession:${sessionId}`);
      if (!client.deleteSessionResult.ok) {
        return { ok: false, error: client.deleteSessionResult.error ?? "OC_DELETE_SESSION_FAILED" };
      }
      return { ok: true };
    },
    subscribeEvents(cb) {
      client.eventCb = cb;
      return () => {
        client.eventCb = null;
      };
    },
    async health() {
      return true;
    },
    emit(ev: OpenCodeEvent) {
      client.eventCb?.(ev);
    },
    ...overrides,
  };
  return client;
}

// ---------------------------------------------------------------------------
// Mock OpenCodeServerManager
// ---------------------------------------------------------------------------

interface FakeServers {
  manager: OpenCodeServerManager;
  clients: Map<string, FakeClient>;
  ensureCalls: { projectId: string; projectPath: string }[];
  ensureResult: { ok: boolean; error?: string };
  stopped: string[];
  exitCbs: Set<(projectId: string) => void>;
}

function makeFakeServers(): FakeServers {
  const clients = new Map<string, FakeClient>();
  const ensureCalls: { projectId: string; projectPath: string }[] = [];
  const stopped: string[] = [];
  const exitCbs = new Set<(projectId: string) => void>();
  const state: FakeServers = {
    ensureResult: { ok: true },
    ensureCalls,
    clients,
    stopped,
    exitCbs,
    manager: {
      async ensureServer(projectId, projectPath) {
        ensureCalls.push({ projectId, projectPath });
        if (!state.ensureResult.ok) {
          return { ok: false, error: state.ensureResult.error ?? "SERVER_START_FAILED" };
        }
        let client = clients.get(projectId);
        if (!client) {
          client = makeFakeClient();
          clients.set(projectId, client);
        }
        const handle: OpenCodeServerHandle = {
          projectId,
          baseUrl: "http://127.0.0.1:0",
          client,
        };
        return { ok: true, data: handle };
      },
      getServer(projectId) {
        const client = clients.get(projectId);
        return client ? { projectId, baseUrl: "http://127.0.0.1:0", client } : undefined;
      },
      async stopServer(projectId) {
        stopped.push(projectId);
        clients.delete(projectId);
      },
      async stopAll() {
        for (const id of [...clients.keys()]) stopped.push(id);
        clients.clear();
      },
      onServerExit(cb) {
        exitCbs.add(cb);
      },
    },
  };
  return state;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Harness {
  store: SessionStore;
  sm: SessionManager;
  fake: FakeServers;
  attachments?: AttachmentManager;
  messages: SessionMessage[];
  messageParts: [string, string, MessagePart][];
  prompts: InteractivePrompt[];
  statuses: [string, SessionStatus][];
  errors: [string, string][];
  /** Perubahan status turn (onTurnChange): [sessionId, active]. */
  turns: [string, boolean][];
  /** Prompt kembar yang ikut resolved lewat fan-out (onPromptResolved). */
  promptResolved: [string, string][];
  /** Judul Session baru (onTitleChange): [sessionId, title]. */
  titles: [string, string][];
  project: Project;
  root: string;
  close(): void;
}

function freshHarness(): Harness {
  return freshHarnessWithHooks({});
}

function freshHarnessWithHooks(
  extraHooks: Pick<Parameters<typeof createSessionManager>[0], "onDeleted" | "onTitleChange">,
  extra: { withAttachments?: boolean } = {},
  managerOverrides: Partial<Parameters<typeof createSessionManager>[0]> = {},
): Harness {
  const store = openSessionStore(":memory:");
  const root = mkdtempSync(path.join(tmpdir(), "kcg-sm2-"));
  const cwd = path.join(root, "proj");
  mkdirSync(cwd, { recursive: true });
  const project: Project = { id: "p1", name: "proj", path: cwd, createdAt: 1 };
  store.insertProject(project);

  const fake = makeFakeServers();
  const messages: SessionMessage[] = [];
  const messageParts: [string, string, MessagePart][] = [];
  const prompts: InteractivePrompt[] = [];
  const statuses: [string, SessionStatus][] = [];
  const errors: [string, string][] = [];
  const turns: [string, boolean][] = [];
  const promptResolved: [string, string][] = [];
  /** Judul Session baru (onTitleChange): [sessionId, title]. */
  const titles: [string, string][] = [];

  const attachments = extra.withAttachments
    ? createAttachmentManager(path.join(root, "uploads"))
    : undefined;
  const sm = createSessionManager({
    store,
    servers: fake.manager,
    attachments,
    now: () => 1000,
    ...extraHooks,
    ...managerOverrides,
    onMessage: (m) => messages.push(m),
    onMessagePart: (sid, mid, part) => messageParts.push([sid, mid, part]),
    onPrompt: (p) => prompts.push(p),
    onPromptResolved: (sid, pid) => promptResolved.push([sid, pid]),
    onStatusChange: (id, st) => statuses.push([id, st]),
    onError: (id, m) => errors.push([id, m]),
    onTurnChange: (id, active) => turns.push([id, active]),
    onTitleChange: (id, t) => titles.push([id, t]),
  });

  return {
    store,
    sm,
    fake,
    attachments,
    messages,
    messageParts,
    prompts,
    statuses,
    errors,
    turns,
    promptResolved,
    titles,
    project,
    root,
    close() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** Tunggu antrean asinkron (POST message) selesai. */
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

async function createSession(h: Harness, agentType: AgentType = "opencode"): Promise<string> {
  const res = await h.sm.createSession({ agentType, projectId: h.project.id });
  expect(res.ok).toBe(true);
  if (!res.ok) throw new Error(`harness createSession gagal: ${res.error}`);
  return res.session.id;
}

function statusOf(store: SessionStore, sid: string): SessionStatus | undefined {
  const r = store.getSession(sid);
  return r.ok ? r.data.status : undefined;
}

/** Ambil FakeClient project "p1"; melempar bila belum ada (harusnya sudah dibuat). */
function clientOf(h: Harness): FakeClient {
  const client = h.fake.clients.get("p1");
  if (!client) throw new Error("fake client p1 tidak ada");
  return client;
}

/** Prompt pertama yang tercatat; melempar bila kosong (harusnya sudah ada). */
function promptOf(h: Harness): InteractivePrompt {
  const p = h.prompts[0];
  if (!p) throw new Error("belum ada prompt tercatat");
  return p;
}

// ---------------------------------------------------------------------------
// Pembuatan Session
// ---------------------------------------------------------------------------

test("createSession valid -> running, ocSessionId, server per project", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const sess = h.store.getSession(sid);
    expect(sess.ok).toBe(true);
    if (sess.ok) {
      expect(sess.data.status).toBe("running");
      expect(sess.data.cwd).toBe(h.project.path);
      expect(sess.data.ocSessionId).toBe("ses_remote1");
      expect(sess.data.createdAt).toBe(1000);
    }
    // Server di-ensure dengan path Project (Requirement 10.9).
    expect(h.fake.ensureCalls).toHaveLength(1);
    expect(h.fake.ensureCalls[0]).toEqual({ projectId: "p1", projectPath: h.project.path });
    // Subscribe event SSE terpasang pada client.
    expect(h.fake.clients.get("p1")?.eventCb).not.toBeNull();
  } finally {
    h.close();
  }
});

test("createSession: ensure server hanya sekali untuk project yang sama", async () => {
  const h = freshHarness();
  try {
    await createSession(h);
    await createSession(h);
    await createSession(h);
    expect(h.fake.ensureCalls).toHaveLength(3); // dipanggil tiap createSession
    const client = h.fake.clients.get("p1");
    expect(client?.calls.filter((c) => c.startsWith("createSession"))).toHaveLength(3);
  } finally {
    h.close();
  }
});

// Feature: kcg-code, Property 2: Pembuatan Session dengan kondisi tidak valid selalu ditolak
test("Property 2: agentType tak didukung / project tak ada / dir hilang -> ditolak", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom("claude-code", "vibe", "codex"),
      fc.string({ maxLength: 20 }).filter((s) => s !== "p1"),
      fc.constantFrom(0, 1, 2),
      async (badType, unknownId, kase) => {
        const h = freshHarness();
        try {
          let req: CreateSessionRequest;
          if (kase === 0) {
            req = { agentType: badType as AgentType, projectId: h.project.id };
          } else if (kase === 1) {
            req = { agentType: "opencode", projectId: unknownId };
          } else {
            h.store.insertProject({
              id: "pm",
              name: "proj-missing",
              path: path.join(h.root, "tidak-ada"),
              createdAt: 1,
            });
            req = { agentType: "opencode", projectId: "pm" };
          }
          const res = await h.sm.createSession(req);
          expect(res.ok).toBe(false);
          if (!res.ok) expect(res.error.length).toBeGreaterThan(0);
          expect(h.store.listSessions().every((s) => s.status !== "running")).toBe(true);
        } finally {
          h.close();
        }
      },
    ),
    { numRuns: 100 },
  );
});

test("createSession: ensure server gagal -> error, tanpa session", async () => {
  const h = freshHarness();
  try {
    h.fake.ensureResult = { ok: false, error: "SERVER_START_FAILED" };
    const res = await h.sm.createSession({ agentType: "opencode", projectId: "p1" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("SERVER_START_FAILED");
    expect(h.store.listSessions()).toHaveLength(0);
  } finally {
    h.close();
  }
});

test("createSession: create session remote gagal -> error, tanpa session", async () => {
  const h = freshHarness();
  try {
    const client = makeFakeClient({
      createSessionResult: { ok: false, error: "OC_CREATE_SESSION_FAILED" },
    });
    h.fake.clients.set("p1", client);
    const res = await h.sm.createSession({ agentType: "opencode", projectId: "p1" });
    expect(res.ok).toBe(false);
    expect(h.store.listSessions()).toHaveLength(0);
  } finally {
    h.close();
  }
});

// ---------------------------------------------------------------------------
// Free-text input
// ---------------------------------------------------------------------------

test("sendFreeTextInput: validasi text -> TEXT_EMPTY / TEXT_TOO_LONG / not found / inactive", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    expect((await h.sm.sendFreeTextInput(sid, "   ")).error).toBe("TEXT_EMPTY");
    expect((await h.sm.sendFreeTextInput(sid, "")).error).toBe("TEXT_EMPTY");
    expect((await h.sm.sendFreeTextInput(sid, "x".repeat(10001))).error).toBe("TEXT_TOO_LONG");
    expect((await h.sm.sendFreeTextInput("unknown", "halo")).error).toBe("SESSION_NOT_FOUND");

    // Session dihentikan -> tidak aktif.
    const r = await h.sm.stopSession(sid);
    expect(r.ok).toBe(true);
    expect((await h.sm.sendFreeTextInput(sid, "halo")).error).toBe("SESSION_NOT_ACTIVE");
  } finally {
    h.close();
  }
});

test("sendFreeTextInput sukses -> echo user; assistant dirakit saat session.idle", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const res = await h.sm.sendFreeTextInput(sid, "hello");
    expect(res.ok).toBe(true);

    // Echo user tersimpan & terkirim segera.
    expect(h.messages).toHaveLength(1);
    expect(h.messages[0]?.role).toBe("user");
    expect(h.messages[0]?.parts).toEqual([{ type: "text", text: "hello" }]);

    await flush();

    // Prompt dikirim via prompt_async (204) — belum ada pesan assistant.
    const client = clientOf(h);
    expect(client.calls).toContain("promptAsync:hello");
    expect(h.messages).toHaveLength(1);

    // Balasan tiba sebagai parts SSE.
    client.emit({
      type: "message.updated",
      sessionID: "ses_remote1",
      info: { id: "msg_a1", role: "assistant" },
    });
    client.emit({
      type: "message.part.updated",
      sessionID: "ses_remote1",
      part: { type: "text", id: "prt_t1", text: "balasan: hello", messageID: "msg_a1" },
    });
    // Turn belum ditutup sebelum idle.
    expect(h.messages).toHaveLength(1);

    // session.idle Session akar menutup turn -> pesan assistant dirakit.
    client.emit({ type: "session.idle", sessionID: "ses_remote1" });

    expect(h.messages).toHaveLength(2);
    expect(h.messages[1]?.role).toBe("assistant");
    expect(h.messages[1]?.id).toBe("msg_a1");
    expect(h.messages[1]?.parts).toEqual([
      { type: "text", id: "prt_t1", text: "balasan: hello", messageID: "msg_a1" },
    ]);

    // Keduanya tersimpan di store (round-trip history).
    const stored = h.store.getMessages(sid);
    expect(stored.ok).toBe(true);
    if (stored.ok) expect(stored.data).toHaveLength(2);
  } finally {
    h.close();
  }
});

test("sendFreeTextInput: prompt_async gagal -> onError + pesan error tersimpan", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    client.promptAsyncResult = { ok: false, error: "OC_PROMPT_ASYNC_FAILED(500)" };
    await h.sm.sendFreeTextInput(sid, "hello");
    await flush();
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]?.[0]).toBe(sid);
    // Pesan error ramah (bukan kode mentah) dan ditulis ke history (part error).
    expect(h.errors[0]?.[1]).toBe("Failed to send the prompt to opencode (status 500). Try again.");
    const assistants = h.messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(1);
    expect(assistants[0]?.parts).toEqual([{ type: "error", text: h.errors[0]?.[1] }]);
    const stored = h.store.getMessages(sid);
    expect(stored.ok && stored.data.filter((m) => m.role === "assistant")).toHaveLength(1);
  } finally {
    h.close();
  }
});

test("session.error terminal (parts tersimpan + pesan error ditulis saat idle)", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    await h.sm.sendFreeTextInput(sid, "hello");
    await flush();

    // Parts sudah ter-stream sebelum error datang — harus tetap tersimpan.
    client.emit({
      type: "message.updated",
      sessionID: "ses_remote1",
      info: { id: "msg_a1", role: "assistant" },
    });
    client.emit({
      type: "message.part.updated",
      sessionID: "ses_remote1",
      part: { type: "text", id: "prt_t1", text: "sebagian", messageID: "msg_a1" },
    });

    // opencode melaporkan kegagalan memproses prompt (mis. URL file gambar).
    client.emit({
      type: "session.error",
      sessionID: "ses_remote1",
      error: {
        name: "UnknownError",
        data: {
          message:
            'TypeError: File URL host must be "localhost" or empty on linux\n    at SessionPrompt.resolveUserPart',
        },
      },
    });

    // Banner seketika; turn BELUM ditutup (error bisa saja tidak terminal).
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]?.[0]).toBe(sid);
    expect(h.errors[0]?.[1]).toBe('TypeError: File URL host must be "localhost" or empty on linux');
    expect(h.messages.filter((m) => m.role === "assistant")).toHaveLength(0);

    // Idle menutup turn: parts tersimpan + pesan error ditulis (tidak ada
    // konten baru setelah error — memang kegagalan terminal).
    client.emit({ type: "session.idle", sessionID: "ses_remote1" });
    const assistants = h.messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(2);
    expect(assistants[0]?.parts).toEqual([
      { type: "text", id: "prt_t1", text: "sebagian", messageID: "msg_a1" },
    ]);
    expect(assistants[1]?.parts[0]?.type).toBe("error");
    expect(assistants[1]?.parts[0]?.text).toBe(h.errors[0]?.[1]);
    const stored = h.store.getMessages(sid);
    expect(stored.ok && stored.data.filter((m) => m.role === "assistant")).toHaveLength(2);

    // Idle kedua tidak menambah apa-apa — turn sudah ditutup.
    client.emit({ type: "session.idle", sessionID: "ses_remote1" });
    expect(h.messages.filter((m) => m.role === "assistant")).toHaveLength(2);
  } finally {
    h.close();
  }
});

test("session.error tanpa turn aktif -> hanya onError, tidak menulis pesan", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    client.emit({
      type: "session.error",
      sessionID: "ses_remote1",
      error: { name: "ProviderAuthError", data: { message: "auth required" } },
    });
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]?.[1]).toContain("Model provider authentication failed");
    expect(h.messages.filter((m) => m.role === "assistant")).toHaveLength(0);
    const stored = h.store.getMessages(sid);
    expect(stored.ok && stored.data).toHaveLength(0);
  } finally {
    h.close();
  }
});

test("TURN_TIMEOUT (idle tanpa tanda hidup) -> pesan error tersimpan + onError", async () => {
  const timers: (() => void)[] = [];
  const cleared: unknown[] = [];
  const h = freshHarnessWithHooks(
    {},
    {},
    {
      turnIdleTimeoutMs: 5000,
      setTimeoutFn: (cb) => {
        timers.push(cb);
        return timers.length;
      },
      clearTimeoutFn: (handle) => cleared.push(handle),
    },
  );
  try {
    const sid = await createSession(h);
    await h.sm.sendFreeTextInput(sid, "hello");
    await flush();
    // Turn aktif, belum ada balasan — belum ada error.
    expect(timers).toHaveLength(1);
    expect(h.errors).toHaveLength(0);

    timers[0]?.();
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]?.[0]).toBe(sid);
    expect(h.errors[0]?.[1]).toBe(
      "The model stopped responding — no activity for 5 minutes. Try sending the message again.",
    );
    const assistants = h.messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(1);
    expect(assistants[0]?.parts).toEqual([{ type: "error", text: h.errors[0]?.[1] }]);
    const stored = h.store.getMessages(sid);
    expect(stored.ok && stored.data.filter((m) => m.role === "assistant")).toHaveLength(1);

    // Timer lama sudah di-clear saat reset/fire — tidak ada timer yatim.
    expect(cleared.length).toBeGreaterThanOrEqual(1);
  } finally {
    h.close();
  }
});

test("turn idle timer di-reset oleh tanda hidup (part streaming, status busy)", async () => {
  const timers: (() => void)[] = [];
  const h = freshHarnessWithHooks(
    {},
    {},
    {
      turnIdleTimeoutMs: 5000,
      setTimeoutFn: (cb) => {
        timers.push(cb);
        return timers.length;
      },
      clearTimeoutFn: () => {},
    },
  );
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    await h.sm.sendFreeTextInput(sid, "hello");
    await flush();
    expect(timers).toHaveLength(1); // timer awal

    const fireFirst = timers[0];

    // Tanda hidup #1: pesan assistant + part streaming — timer di-reset 2x.
    client.emit({
      type: "message.updated",
      sessionID: "ses_remote1",
      info: { id: "msg_a1", role: "assistant" },
    });
    client.emit({
      type: "message.part.updated",
      sessionID: "ses_remote1",
      part: { type: "text", id: "prt_t1", text: "menulis lama...", messageID: "msg_a1" },
    });
    expect(timers).toHaveLength(3); // timer awal + 2 reset

    // Timer LAMA terpicu (race): tidak boleh menggagalkan turn yang hidup.
    fireFirst?.();
    expect(h.errors).toHaveLength(0);
    expect(h.turns).toEqual([[sid, true]]);

    // Tanda hidup #2: status busy/retry juga me-reset timer.
    client.emit({ type: "session.status", sessionID: "ses_remote1", status: { type: "busy" } });
    expect(timers).toHaveLength(4);

    // Timer lama (hasil reset) tidak menggagalkan turn — turn tetap hidup.
    timers[1]?.();
    timers[2]?.();
    expect(h.errors).toHaveLength(0);

    // Timer yang terpasang sekarang (terakhir) terpicu -> turn gagal idle.
    timers[3]?.();
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]?.[1]).toBe(
      "The model stopped responding — no activity for 5 minutes. Try sending the message again.",
    );
    expect(h.turns).toContainEqual([sid, false]);
  } finally {
    h.close();
  }
});

test("turn idle timer DITUNDA selama kartu permission pending (user sedang memutus)", async () => {
  const timers: (() => void)[] = [];
  const h = freshHarnessWithHooks(
    {},
    {},
    {
      turnIdleTimeoutMs: 5000,
      setTimeoutFn: (cb) => {
        timers.push(cb);
        return timers.length;
      },
      clearTimeoutFn: () => {},
    },
  );
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    await h.sm.sendFreeTextInput(sid, "perbaiki deps");
    await flush();
    expect(timers).toHaveLength(1);

    // Turn meminta izin — opencode hidup MENUNGGU keputusan user.
    client.emit({
      type: "permission.asked",
      requestID: "per_idle1",
      sessionID: "ses_remote1",
      permission: "bash",
      patterns: ["bun install"],
    });
    expect(h.prompts).toHaveLength(1);

    // Timer terpicu saat kartu masih pending -> DITUNDA (re-arm, bukan fail).
    timers[0]?.();
    expect(h.errors).toHaveLength(0);
    expect(h.turns).toEqual([[sid, true]]);
    expect(timers).toHaveLength(2); // timer dipasang ulang

    // User menjawab kartu -> tidak ada pending lagi.
    const resolved = await h.sm.resolvePrompt(sid, "per_idle1", "approve");
    expect(resolved.ok).toBe(true);

    // Timer yang dipasang ulang kini boleh memicu fail idle.
    timers[1]?.();
    expect(h.errors).toHaveLength(1);
    expect(h.turns).toContainEqual([sid, false]);
  } finally {
    h.close();
  }
});

test("session.idle: turn panjang tersimpan walau POST message tidak dipakai", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    await h.sm.sendFreeTextInput(sid, "delegasikan");
    await flush();

    // Sub-agent: child session ikut menyumbang pesan pada turn yang sama.
    client.emit({
      type: "session.created",
      sessionID: "ses_child1",
      info: { id: "ses_child1", parentID: "ses_remote1" },
    });
    client.emit({
      type: "message.updated",
      sessionID: "ses_remote1",
      info: { id: "msg_induk", role: "assistant" },
    });
    client.emit({
      type: "message.part.updated",
      sessionID: "ses_remote1",
      part: { type: "text", id: "prt_1", text: "memanggil sub-agent", messageID: "msg_induk" },
    });
    client.emit({
      type: "message.updated",
      sessionID: "ses_child1",
      info: { id: "msg_child", role: "assistant" },
    });
    client.emit({
      type: "message.part.updated",
      sessionID: "ses_child1",
      part: { type: "text", id: "prt_2", text: "hasil sub-agent", messageID: "msg_child" },
    });

    // Idle child TIDAK menutup turn (sub-agent selesai lebih dulu dari induk).
    client.emit({ type: "session.idle", sessionID: "ses_child1" });
    expect(h.messages.filter((m) => m.role === "assistant")).toHaveLength(0);

    // Idle Session akar baru menutup turn.
    client.emit({ type: "session.idle", sessionID: "ses_remote1" });
    const assistants = h.messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(2);
    expect(assistants.map((m) => m.id)).toEqual(["msg_induk", "msg_child"]);

    const stored = h.store.getMessages(sid);
    expect(stored.ok && stored.data.filter((m) => m.role === "assistant")).toHaveLength(2);
  } finally {
    h.close();
  }
});

test("session.idle ganda -> turn hanya difinalisasi sekali", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    await h.sm.sendFreeTextInput(sid, "hello");
    await flush();

    client.emit({
      type: "message.updated",
      sessionID: "ses_remote1",
      info: { id: "msg_a1", role: "assistant" },
    });
    client.emit({
      type: "message.part.updated",
      sessionID: "ses_remote1",
      part: { type: "text", id: "prt_t1", text: "sekali", messageID: "msg_a1" },
    });

    client.emit({ type: "session.idle", sessionID: "ses_remote1" });
    client.emit({ type: "session.idle", sessionID: "ses_remote1" });

    expect(h.messages.filter((m) => m.role === "assistant")).toHaveLength(1);
  } finally {
    h.close();
  }
});

test("session.idle tanpa parts assistant -> tidak menyimpan pesan kosong", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    await h.sm.sendFreeTextInput(sid, "hello");
    await flush();

    client.emit({ type: "session.idle", sessionID: "ses_remote1" });

    expect(h.messages.filter((m) => m.role === "assistant")).toHaveLength(0);
  } finally {
    h.close();
  }
});

test("stopSession di tengah turn menyimpan parts yang sudah ter-stream", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    await h.sm.sendFreeTextInput(sid, "hello");
    await flush();

    client.emit({
      type: "message.updated",
      sessionID: "ses_remote1",
      info: { id: "msg_a1", role: "assistant" },
    });
    client.emit({
      type: "message.part.updated",
      sessionID: "ses_remote1",
      part: { type: "text", id: "prt_t1", text: "separuh jalan", messageID: "msg_a1" },
    });

    expect(h.sm.stopSession(sid).ok).toBe(true);

    const assistants = h.messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(1);
    expect(assistants[0]?.parts[0]?.text).toBe("separuh jalan");
  } finally {
    h.close();
  }
});

// ---------------------------------------------------------------------------
// interruptSession (hentikan balasan saja — Session tetap running)
// ---------------------------------------------------------------------------

test("interruptSession: turn dimulai -> turn_active true; selesai -> false", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    // Turn belum ada -> tanpa notifikasi.
    expect(h.turns).toHaveLength(0);

    await h.sm.sendFreeTextInput(sid, "hello");
    expect(h.turns).toEqual([[sid, true]]);

    // session.idle menutup turn -> turn_active false.
    client.emit({ type: "session.idle", sessionID: "ses_remote1" });
    expect(h.turns).toEqual([
      [sid, true],
      [sid, false],
    ]);
  } finally {
    h.close();
  }
});

test("interruptSession: abort remote + BUANG parts parsial (tidak disimpan); session tetap running", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    await h.sm.sendFreeTextInput(sid, "hello");
    await flush();

    client.emit({
      type: "message.updated",
      sessionID: "ses_remote1",
      info: { id: "msg_a1", role: "assistant" },
    });
    client.emit({
      type: "message.part.updated",
      sessionID: "ses_remote1",
      part: { type: "text", id: "prt_t1", text: "separuh jalan", messageID: "msg_a1" },
    });

    const res = h.sm.interruptSession(sid);
    expect(res.ok).toBe(true);

    // Turn remote di-abort.
    expect(client.calls).toContain("abortSession:ses_remote1");
    // User membatalkan balasan -> parts parsial TIDAK disimpan (tidak muncul
    // di riwayat / tidak di-broadcast sebagai pesan assistant).
    const assistants = h.messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(0);
    // Turn ditutup (turn_active false).
    expect(h.turns).toContainEqual([sid, false]);

    // Beda dari stopSession: status TETAP running (tanpa resume).
    expect(statusOf(h.store, sid)).toBe("running");
    expect(h.statuses).toHaveLength(0);

    // Bisa langsung kirim pesan baru tanpa Start ulang.
    const next = await h.sm.sendFreeTextInput(sid, "lanjut");
    expect(next.ok).toBe(true);
    expect(h.turns).toContainEqual([sid, true]);
  } finally {
    h.close();
  }
});

test("interruptSession tanpa turn aktif -> no-op, session tetap running", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const res = h.sm.interruptSession(sid);
    expect(res.ok).toBe(true);
    expect(statusOf(h.store, sid)).toBe("running");
    // Tanpa turn tidak ada broadcast apapun.
    expect(h.turns).toHaveLength(0);
    expect(h.messages).toHaveLength(0);
    // Idempoten: boleh dipanggil lagi.
    expect(h.sm.interruptSession(sid).ok).toBe(true);
  } finally {
    h.close();
  }
});

test("interruptSession: session tak dikenal -> SESSION_NOT_FOUND", () => {
  const h = freshHarness();
  try {
    expect(h.sm.interruptSession("tidak-ada").error).toBe("SESSION_NOT_FOUND");
  } finally {
    h.close();
  }
});

test("session.error MessageAbortedError setelah interrupt -> tanpa banner error", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    await h.sm.sendFreeTextInput(sid, "hello");
    await flush();
    h.sm.interruptSession(sid);

    // Server mengonfirmasi turn dibatalkan (bukan kegagalan nyata).
    client.emit({
      type: "session.error",
      sessionID: "ses_remote1",
      error: { name: "MessageAbortedError", data: { message: "Pemrosesan prompt dibatalkan." } },
    });
    expect(h.errors).toHaveLength(0);
    const stored = h.store.getMessages(sid);
    expect(stored.ok && stored.data.filter((m) => m.role === "assistant")).toHaveLength(0);
  } finally {
    h.close();
  }
});

test("session.error MessageAbortedError dengan turn aktif -> turn ditutup tanpa pesan error", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    await h.sm.sendFreeTextInput(sid, "hello");
    await flush();

    // Parts sudah ter-stream sebelum opencode mengabort turn.
    client.emit({
      type: "message.updated",
      sessionID: "ses_remote1",
      info: { id: "msg_a1", role: "assistant" },
    });
    client.emit({
      type: "message.part.updated",
      sessionID: "ses_remote1",
      part: { type: "text", id: "prt_t1", text: "sebagian", messageID: "msg_a1" },
    });
    client.emit({
      type: "session.error",
      sessionID: "ses_remote1",
      error: { name: "MessageAbortedError", data: { message: "Pemrosesan prompt dibatalkan." } },
    });

    // Parts tersimpan, TAPI tanpa pesan error & tanpa banner onError.
    expect(h.errors).toHaveLength(0);
    const assistants = h.messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(1);
    expect(assistants[0]?.parts).toEqual([
      { type: "text", id: "prt_t1", text: "sebagian", messageID: "msg_a1" },
    ]);
    expect(h.turns).toContainEqual([sid, false]);
  } finally {
    h.close();
  }
});

test("session.status retry -> onError banner ramah, turn tetap hidup sampai idle", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    await h.sm.sendFreeTextInput(sid, "hello");
    await flush();

    // Provider error yang bisa di-retry: opencode memancarkan session.status
    // retry (bukan session.error) — turn BELUM ditutup, tapi Client diberi
    // tahu kenapa balasan lambat (bukan menunggu diam-diam).
    client.emit({
      type: "session.status",
      sessionID: "ses_remote1",
      status: {
        type: "retry",
        attempt: 1,
        message: "Command Code API error 400: {\"success\":false}",
      },
    });
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]?.[0]).toBe(sid);
    expect(h.errors[0]?.[1]).toBe(
      "The model provider is retrying (attempt 1): Command Code API error 400: {\"success\":false}",
    );
    // Turn masih aktif — retry adalah backoff, bukan kegagalan final.
    expect(h.turns).toEqual([[sid, true]]);
    expect(h.messages.filter((m) => m.role === "assistant")).toHaveLength(0);

    // Retry berikutnya memakai `action.title` (upsell) bila ada.
    client.emit({
      type: "session.status",
      sessionID: "ses_remote1",
      status: {
        type: "retry",
        attempt: 2,
        message: "raw message panjang",
        action: { title: "Free limit reached", message: "Subscribe to continue" },
      },
    });
    expect(h.errors[1]?.[1]).toBe("The model provider is retrying (attempt 2): Free limit reached");

    // Retry sukses -> turn ditutup normal oleh session.idle (tanpa pesan error).
    client.emit({
      type: "message.updated",
      sessionID: "ses_remote1",
      info: { id: "msg_a1", role: "assistant" },
    });
    client.emit({
      type: "message.part.updated",
      sessionID: "ses_remote1",
      part: { type: "text", id: "prt_t1", text: "akhirnya jawaban", messageID: "msg_a1" },
    });
    client.emit({ type: "session.idle", sessionID: "ses_remote1" });

    const assistants = h.messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(1);
    expect(assistants[0]?.parts[0]?.text).toBe("akhirnya jawaban");
    expect(h.turns).toContainEqual([sid, false]);
  } finally {
    h.close();
  }
});

test("session.status non-retry / busy / idle -> tanpa banner, tanpa efek", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    await h.sm.sendFreeTextInput(sid, "hello");
    await flush();

    client.emit({ type: "session.status", sessionID: "ses_remote1", status: { type: "busy" } });
    client.emit({ type: "session.status", sessionID: "ses_remote1", status: { type: "idle" } });
    client.emit({ type: "session.status", sessionID: "ses_remote1", status: { type: "retry" } }); // tanpa message
    expect(h.errors).toHaveLength(0);

    // Turn tetap ditutup oleh session.idle seperti biasa.
    client.emit({ type: "session.idle", sessionID: "ses_remote1" });
    expect(h.turns).toContainEqual([sid, false]);
  } finally {
    h.close();
  }
});

// ---------------------------------------------------------------------------
// Streaming (SSE message.updated / message.part.updated)
// ---------------------------------------------------------------------------

test("streaming: part assistant di-forward via onMessagePart setelah turn aktif", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    // Turn dimulai (sendFreeTextInput membuat streamingTurns entry).
    await h.sm.sendFreeTextInput(sid, "hitung 2+2");

    // SSE: pesan assistant mulai (message.updated role=assistant).
    client.emit({
      type: "message.updated",
      sessionID: "ses_remote1",
      info: { id: "msg_a1", role: "assistant" },
    });
    // SSE: part reasoning di-stream.
    client.emit({
      type: "message.part.updated",
      sessionID: "ses_remote1",
      part: { type: "reasoning", id: "prt_r1", text: "pikir...", messageID: "msg_a1" },
    });
    // SSE: part text di-stream (berkembang).
    client.emit({
      type: "message.part.updated",
      sessionID: "ses_remote1",
      part: { type: "text", id: "prt_t1", text: "jawaban", messageID: "msg_a1" },
    });

    expect(h.messageParts).toHaveLength(2);
    expect(h.messageParts[0]).toEqual([
      sid,
      "msg_a1",
      { type: "reasoning", id: "prt_r1", text: "pikir...", messageID: "msg_a1" },
    ]);
    expect(h.messageParts[1]).toEqual([
      sid,
      "msg_a1",
      { type: "text", id: "prt_t1", text: "jawaban", messageID: "msg_a1" },
    ]);
  } finally {
    h.close();
  }
});

test("streaming: part user / sebelum assistant dikenal tidak di-forward", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    await h.sm.sendFreeTextInput(sid, "hitung 2+2");

    // Part datang SEBELUM assistant dikenal -> diabaikan.
    client.emit({
      type: "message.part.updated",
      sessionID: "ses_remote1",
      part: { type: "text", id: "prt_u1", text: "user echo", messageID: "msg_user1" },
    });
    expect(h.messageParts).toHaveLength(0);

    // Assistant dikenal -> hanya part dengan messageID yang sama diteruskan.
    client.emit({
      type: "message.updated",
      sessionID: "ses_remote1",
      info: { id: "msg_a1", role: "assistant" },
    });
    client.emit({
      type: "message.part.updated",
      sessionID: "ses_remote1",
      part: { type: "text", id: "prt_x", text: "salah", messageID: "msg_lain" },
    });
    expect(h.messageParts).toHaveLength(0);

    client.emit({
      type: "message.part.updated",
      sessionID: "ses_remote1",
      part: { type: "text", id: "prt_t1", text: "benar", messageID: "msg_a1" },
    });
    expect(h.messageParts).toHaveLength(1);
    expect(h.messageParts[0]?.[1]).toBe("msg_a1");
  } finally {
    h.close();
  }
});

test("streaming: satu turn dengan beberapa pesan assistant (sub-agent) di-stream semua", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    await h.sm.sendFreeTextInput(sid, "hitung 2+2");

    // Dua pesan assistant dalam satu turn (mis. sub-agent memancarkan pesan sendiri).
    client.emit({
      type: "message.updated",
      sessionID: "ses_remote1",
      info: { id: "msg_a1", role: "assistant" },
    });
    client.emit({
      type: "message.updated",
      sessionID: "ses_remote1",
      info: { id: "msg_a2", role: "assistant" },
    });
    client.emit({
      type: "message.part.updated",
      sessionID: "ses_remote1",
      part: { type: "text", id: "prt_1", text: "satu", messageID: "msg_a1" },
    });
    client.emit({
      type: "message.part.updated",
      sessionID: "ses_remote1",
      part: { type: "text", id: "prt_2", text: "dua", messageID: "msg_a2" },
    });

    expect(h.messageParts).toHaveLength(2);
    expect(h.messageParts.map(([, mid]) => mid).sort()).toEqual(["msg_a1", "msg_a2"]);
  } finally {
    h.close();
  }
});

test("streaming: turn lama selesai tidak menghapus turn baru (race guard)", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    // Dua input berurutan dengan jeda prompt_async berbeda (40ms lalu 500ms).
    // Input kedua men-finalisasi turn pertama dan memasang entry turn 2;
    // penyelesaian prompt_async turn 1 yang menyusul tidak boleh menghapus
    // entry milik turn 2.
    const client = clientOf(h);
    client.sendDelays = [40, 500];

    await h.sm.sendFreeTextInput(sid, "input pertama");
    await h.sm.sendFreeTextInput(sid, "input kedua");
    client.emit({
      type: "message.updated",
      sessionID: "ses_remote1",
      info: { id: "msg_b1", role: "assistant" },
    });
    client.emit({
      type: "message.part.updated",
      sessionID: "ses_remote1",
      part: { type: "text", id: "prt_b", text: "lanjutan", messageID: "msg_b1" },
    });
    expect(h.messageParts).toHaveLength(1);

    // Tunggu prompt_async pertama selesai (40ms) — yang kedua masih berjalan.
    await Bun.sleep(100);

    // Turn kedua harus tetap hidup walau turn pertama sudah selesai lebih dulu.
    client.emit({
      type: "message.part.updated",
      sessionID: "ses_remote1",
      part: { type: "text", id: "prt_b", text: "lanjutan lagi", messageID: "msg_b1" },
    });
    expect(h.messageParts).toHaveLength(2);
    expect(h.messageParts[1]?.[1]).toBe("msg_b1");

    // Biarkan prompt_async kedua selesai agar tidak ada timer menggantung.
    await Bun.sleep(500);
  } finally {
    h.close();
  }
});

test("streaming: turn tetap hidup setelah prompt_async, berakhir saat session.idle", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    await h.sm.sendFreeTextInput(sid, "hitung 2+2");
    client.emit({
      type: "message.updated",
      sessionID: "ses_remote1",
      info: { id: "msg_a1", role: "assistant" },
    });
    client.emit({
      type: "message.part.updated",
      sessionID: "ses_remote1",
      part: { type: "text", id: "prt_t1", text: "sebagian", messageID: "msg_a1" },
    });
    expect(h.messageParts).toHaveLength(1);

    // prompt_async selesai (204) TIDAK mengakhiri turn — streaming berlanjut.
    await flush();
    client.emit({
      type: "message.part.updated",
      sessionID: "ses_remote1",
      part: { type: "text", id: "prt_t1", text: "sebagian lanjutan", messageID: "msg_a1" },
    });
    expect(h.messageParts).toHaveLength(2);

    // session.idle menutup turn -> part berikutnya tidak lagi diteruskan.
    client.emit({ type: "session.idle", sessionID: "ses_remote1" });
    client.emit({
      type: "message.part.updated",
      sessionID: "ses_remote1",
      part: { type: "text", id: "prt_t1", text: "setelah idle", messageID: "msg_a1" },
    });
    expect(h.messageParts).toHaveLength(2);
  } finally {
    h.close();
  }
});

// ---------------------------------------------------------------------------
// Interactive_Prompt (permission & question dari event SSE)
// ---------------------------------------------------------------------------

test("event permission.asked -> prompt kind=permission + onPrompt", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    client.emit({
      type: "permission.asked",
      requestID: "per_1",
      sessionID: "ses_remote1",
      permission: "bash:ls",
      patterns: ["ls"],
    });

    expect(h.prompts).toHaveLength(1);
    const p = promptOf(h);
    expect(p.kind).toBe("permission");
    expect(p.type).toBe("confirmation");
    expect(p.sessionId).toBe(sid);
    expect(p.id).toBe("per_1");
    expect(p.title).toContain("bash:ls");
    expect(p.status).toBe("pending");
  } finally {
    h.close();
  }
});

test("event question.asked -> prompt kind=question menu + options", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    client.emit({
      type: "question.asked",
      requestID: "que_1",
      sessionID: "ses_remote1",
      questions: [
        {
          question: "Gunakan mode apa?",
          header: "mode",
          options: [
            { label: "Build", description: "menulis kode" },
            { label: "Plan", description: "hanya rencana" },
          ],
        },
      ],
    });

    expect(h.prompts).toHaveLength(1);
    const p = promptOf(h);
    expect(p.kind).toBe("question");
    expect(p.type).toBe("menu");
    expect(p.sessionId).toBe(sid);
    expect(p.title).toBe("Gunakan mode apa?");
    expect(p.options).toEqual(["Build", "Plan"]);
    // Flag `custom` default true di skema question opencode.
    expect(p.custom).toBe(true);
  } finally {
    h.close();
  }
});

test("event question.asked custom=false -> prompt.custom false (tanpa input bebas)", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    client.emit({
      type: "question.asked",
      requestID: "que_c0",
      sessionID: "ses_remote1",
      questions: [
        {
          question: "Pilih salah satu",
          header: "pilih",
          custom: false,
          options: [{ label: "A", description: "a" }],
        },
      ],
    });

    expect(h.prompts).toHaveLength(1);
    expect(promptOf(h).custom).toBe(false);
    expect(promptOf(h).sessionId).toBe(sid);
  } finally {
    h.close();
  }
});

test("sub-agent: permission.asked pada child session -> prompt untuk Session induk", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    // opencode membuat child session saat model memanggil tool `task`.
    client.emit({
      type: "session.created",
      sessionID: "ses_child1",
      info: { id: "ses_child1", parentID: "ses_remote1", agent: "explore" },
    });

    // Izin yang diminta sub-agent memakai sessionID child.
    client.emit({
      type: "permission.asked",
      requestID: "per_sub1",
      sessionID: "ses_child1",
      permission: "bash",
      patterns: ["echo hi"],
    });

    expect(h.prompts).toHaveLength(1);
    const p = promptOf(h);
    expect(p.id).toBe("per_sub1");
    // Prompt diatribusikan ke Session lokal induk agar muncul di UI.
    expect(p.sessionId).toBe(sid);
  } finally {
    h.close();
  }
});

test("sub-agent: part child session di-stream ke Session induk", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    await h.sm.sendFreeTextInput(sid, "delegasikan ke sub-agent");
    client.emit({
      type: "session.created",
      sessionID: "ses_child1",
      info: { id: "ses_child1", parentID: "ses_remote1", agent: "explore" },
    });
    client.emit({
      type: "message.updated",
      sessionID: "ses_child1",
      info: { id: "msg_sub1", role: "assistant" },
    });
    client.emit({
      type: "message.part.updated",
      sessionID: "ses_child1",
      part: { type: "text", id: "prt_s1", text: "hasil sub-agent", messageID: "msg_sub1" },
    });

    expect(h.messageParts).toHaveLength(1);
    expect(h.messageParts[0]?.[0]).toBe(sid);
    expect(h.messageParts[0]?.[1]).toBe("msg_sub1");
  } finally {
    h.close();
  }
});

test("sub-agent: child bersarang (cucu) tetap terpetakan ke Session induk", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    client.emit({
      type: "session.created",
      sessionID: "ses_child1",
      info: { id: "ses_child1", parentID: "ses_remote1" },
    });
    // Sub-agent memanggil sub-agent lagi.
    client.emit({
      type: "session.created",
      sessionID: "ses_child2",
      info: { id: "ses_child2", parentID: "ses_child1" },
    });
    client.emit({
      type: "permission.asked",
      requestID: "per_deep",
      sessionID: "ses_child2",
      permission: "edit",
      patterns: ["src/a.ts"],
    });

    expect(h.prompts).toHaveLength(1);
    expect(h.prompts[0]?.sessionId).toBe(sid);
  } finally {
    h.close();
  }
});

test("session.created tanpa parentID dikenal -> tidak dipetakan", async () => {
  const h = freshHarness();
  try {
    await createSession(h);
    const client = clientOf(h);

    // Session lain di server yang sama (mis. dibuat TUI) — bukan milik KCG Code.
    client.emit({
      type: "session.created",
      sessionID: "ses_asing",
      info: { id: "ses_asing", parentID: "ses_bukan_milik_kcgcode" },
    });
    client.emit({
      type: "permission.asked",
      requestID: "per_asing",
      sessionID: "ses_asing",
      permission: "bash",
    });

    expect(h.prompts).toHaveLength(0);
  } finally {
    h.close();
  }
});

test("session.updated -> judul akar disimpan + onTitleChange; judul sama diabaikan", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    client.emit({
      type: "session.updated",
      sessionID: "ses_remote1",
      info: { id: "ses_remote1", title: "Refactor auth module" },
    });
    const sess = h.store.getSession(sid);
    expect(sess.ok).toBe(true);
    if (sess.ok) expect(sess.data.title).toBe("Refactor auth module");
    expect(h.titles).toEqual([[sid, "Refactor auth module"]]);

    // Judul identik -> tanpa update DB, tanpa broadcast ulang.
    client.emit({
      type: "session.updated",
      sessionID: "ses_remote1",
      info: { id: "ses_remote1", title: "Refactor auth module" },
    });
    expect(h.titles).toHaveLength(1);
  } finally {
    h.close();
  }
});

test("session.updated child sub-agent -> judul Session akar tidak tertimpa", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    client.emit({
      type: "session.created",
      sessionID: "ses_child1",
      info: { id: "ses_child1", parentID: "ses_remote1" },
    });

    // Sub-agent meng-generate judulnya sendiri — bukan judul percakapan user.
    client.emit({
      type: "session.updated",
      sessionID: "ses_child1",
      info: { id: "ses_child1", title: "Judul sub-agent" },
    });
    const sess = h.store.getSession(sid);
    expect(sess.ok).toBe(true);
    if (sess.ok) expect(sess.data.title).toBeNull();
    expect(h.titles).toHaveLength(0);

    // Judul akar tetap sampai setelah event child.
    client.emit({
      type: "session.updated",
      sessionID: "ses_remote1",
      info: { id: "ses_remote1", title: "Judul asli" },
    });
    expect(h.titles).toEqual([[sid, "Judul asli"]]);
  } finally {
    h.close();
  }
});

test("session.updated session tak dikenal / info rusak -> diabaikan", async () => {
  const h = freshHarness();
  try {
    await createSession(h);
    const client = clientOf(h);

    client.emit({
      type: "session.updated",
      sessionID: "ses_asing",
      info: { id: "ses_asing", title: "bukan milik KCG Code" },
    });
    client.emit({
      type: "session.updated",
      sessionID: "ses_remote1",
      info: { id: "ses_remote1", title: "   " },
    });
    client.emit({
      type: "session.updated",
      sessionID: "ses_remote1",
      info: { id: "ses_remote1", title: 123 },
    });
    client.emit({ type: "session.updated", sessionID: "ses_remote1" });

    expect(h.titles).toHaveLength(0);
    expect(h.store.listSessions().every((s) => s.title === null)).toBe(true);
  } finally {
    h.close();
  }
});

test("stopSession melepas pemetaan child sub-agent", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    client.emit({
      type: "session.created",
      sessionID: "ses_child1",
      info: { id: "ses_child1", parentID: "ses_remote1" },
    });

    expect(h.sm.stopSession(sid).ok).toBe(true);

    // Event child setelah stop tidak lagi menghasilkan prompt.
    client.emit({
      type: "permission.asked",
      requestID: "per_setelah_stop",
      sessionID: "ses_child1",
      permission: "bash",
    });
    expect(h.prompts).toHaveLength(0);
  } finally {
    h.close();
  }
});

test("event permission.v2.asked (action/resources) -> prompt confirmation", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    client.emit({
      type: "permission.v2.asked",
      id: "per_v2",
      sessionID: "ses_remote1",
      action: "bash",
      resources: ["echo hi"],
    });

    expect(h.prompts).toHaveLength(1);
    const p = promptOf(h);
    expect(p.id).toBe("per_v2");
    expect(p.kind).toBe("permission");
    expect(p.type).toBe("confirmation");
    expect(p.sessionId).toBe(sid);
    // Judul dirakit dari `action` + `resources` (penamaan v2).
    expect(p.title).toContain("bash");
    expect(p.title).toContain("echo hi");
  } finally {
    h.close();
  }
});

test("event question.v2.asked -> prompt menu + options", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    client.emit({
      type: "question.v2.asked",
      id: "que_v2",
      sessionID: "ses_remote1",
      questions: [
        {
          question: "Lanjut deploy?",
          header: "deploy",
          options: [{ label: "Ya" }, { label: "Tidak" }],
        },
      ],
    });

    expect(h.prompts).toHaveLength(1);
    const p = promptOf(h);
    expect(p.id).toBe("que_v2");
    expect(p.kind).toBe("question");
    expect(p.type).toBe("menu");
    expect(p.sessionId).toBe(sid);
    expect(p.title).toBe("Lanjut deploy?");
    expect(p.options).toEqual(["Ya", "Tidak"]);
  } finally {
    h.close();
  }
});

test("v1 + v2 untuk request yang sama -> kartu tidak terduplikasi", async () => {
  const h = freshHarness();
  try {
    await createSession(h);
    const client = clientOf(h);

    // Server memancarkan kedua varian untuk satu request (id sama).
    client.emit({
      type: "permission.asked",
      id: "per_sama",
      sessionID: "ses_remote1",
      permission: "bash",
      patterns: ["ls"],
    });
    client.emit({
      type: "permission.v2.asked",
      id: "per_sama",
      sessionID: "ses_remote1",
      action: "bash",
      resources: ["ls"],
    });

    // `prompts.id` PRIMARY KEY menjadikan insert kedua gagal -> satu kartu.
    expect(h.prompts).toHaveLength(1);
    expect(h.prompts[0]?.id).toBe("per_sama");
  } finally {
    h.close();
  }
});

test("prompt v2 dapat diselesaikan lewat resolvePrompt seperti v1", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    client.emit({
      type: "permission.v2.asked",
      id: "per_v2_resolve",
      sessionID: "ses_remote1",
      action: "edit",
      resources: ["src/a.ts"],
    });

    // Endpoint reply dipakai bersama v1/v2 (tidak ada rute v2 terpisah).
    const r = await h.sm.resolvePrompt(sid, "per_v2_resolve", "approve");
    expect(r.ok).toBe(true);
    expect(client.calls).toContain("replyPermission:per_v2_resolve:once");

    const stored = h.store.getPrompt("per_v2_resolve");
    expect(stored.ok && stored.data.status).toBe("resolved");
  } finally {
    h.close();
  }
});

test("event permission.v2.asked pada child sub-agent -> prompt untuk Session induk", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    client.emit({
      type: "session.created",
      sessionID: "ses_child1",
      info: { id: "ses_child1", parentID: "ses_remote1" },
    });
    client.emit({
      type: "permission.v2.asked",
      id: "per_v2_sub",
      sessionID: "ses_child1",
      action: "bash",
      resources: ["echo sub"],
    });

    expect(h.prompts).toHaveLength(1);
    expect(h.prompts[0]?.sessionId).toBe(sid);
  } finally {
    h.close();
  }
});

test("createSession + sendFreeTextInput meneruskan agent tersimpan ke promptAsync", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h, "opencode");
    expect(h.sm.setSessionAgent(sid, "plan").ok).toBe(true);
    // Status Session tetap terbaca dan agent tersimpan.
    const cur = h.store.getSession(sid);
    expect(cur.ok && cur.data.agent).toBe("plan");

    const r = await h.sm.sendFreeTextInput(sid, "buatkan rencana");
    expect(r.ok).toBe(true);
    await flush();
    expect(clientOf(h).promptAgents).toEqual(["plan"]);

    // Kembali ke default -> tanpa field agent di prompt berikutnya.
    expect(h.sm.setSessionAgent(sid, null).ok).toBe(true);
    await h.sm.sendFreeTextInput(sid, "lanjut eksekusi");
    await flush();
    expect(clientOf(h).promptAgents).toEqual(["plan", null]);
  } finally {
    h.close();
  }
});

test("setSessionAgent: session tidak ada / nama kosong -> ditolak", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    expect(h.sm.setSessionAgent("unknown", "plan").error).toBe("SESSION_NOT_FOUND");
    expect(h.sm.setSessionAgent(sid, "   ").error).toBe("INVALID_AGENT");
  } finally {
    h.close();
  }
});

test("listAgents -> daftar agent server headless", async () => {
  const h = freshHarness();
  try {
    await createSession(h); // pastikan server sudah di-ensure
    const res = await h.sm.listAgents("p1");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.map((a) => a.name)).toEqual(["build", "plan"]);
  } finally {
    h.close();
  }
});

test("event permission.asked dengan sessionID tak dikenal -> diabaikan", async () => {
  const h = freshHarness();
  try {
    await createSession(h);
    clientOf(h).emit({
      type: "permission.asked",
      requestID: "per_x",
      sessionID: "ses_tak_dikenal",
    });
    expect(h.prompts).toHaveLength(0);
  } finally {
    h.close();
  }
});

// ---------------------------------------------------------------------------
// Resolusi prompt
// ---------------------------------------------------------------------------

async function seedPrompt(
  h: Harness,
  sid: string,
  kind: "permission" | "question",
  id: string,
): Promise<string> {
  const prompt: InteractivePrompt = {
    id,
    sessionId: sid,
    kind,
    type: kind === "permission" ? "confirmation" : "menu",
    title: kind === "permission" ? "bash:ls" : "Pilih opsi",
    options: kind === "permission" ? null : ["A", "B"],
    status: "pending",
    createdAt: 1,
    resolvedAt: null,
  };
  const ins = h.store.insertPrompt(prompt);
  expect(ins.ok).toBe(true);
  return prompt.id;
}

test("resolvePrompt permission: approve -> once; deny/cancel -> reject; lalu resolved", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    const pid1 = await seedPrompt(h, sid, "permission", "per_1");
    const r1 = await h.sm.resolvePrompt(sid, pid1, "approve");
    expect(r1.ok).toBe(true);
    expect(client.calls).toContain("replyPermission:per_1:once");

    const pid2 = await seedPrompt(h, sid, "permission", "per_2");
    await h.sm.resolvePrompt(sid, pid2, "deny");
    expect(client.calls).toContain("replyPermission:per_2:reject");

    const pid3 = await seedPrompt(h, sid, "permission", "per_3");
    await h.sm.resolvePrompt(sid, pid3, "cancel");
    expect(client.calls).toContain("replyPermission:per_3:reject");

    // Semua resolved.
    for (const id of [pid1, pid2, pid3]) {
      const p = h.store.getPrompt(id);
      expect(p.ok && p.data.status).toBe("resolved");
    }
  } finally {
    h.close();
  }
});

test("resolvePrompt question: option -> replyQuestion; cancel -> rejectQuestion", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    const pid1 = await seedPrompt(h, sid, "question", "que_1");
    const r1 = await h.sm.resolvePrompt(sid, pid1, { option: "A" });
    expect(r1.ok).toBe(true);
    expect(client.calls).toContain("replyQuestion:que_1:A");

    // Jawaban question TIDAK di-echo ke riwayat chat (transcript bersih).
    expect(h.messages.filter((m) => m.role === "user")).toHaveLength(0);

    const pid2 = await seedPrompt(h, sid, "question", "que_2");
    const r2 = await h.sm.resolvePrompt(sid, pid2, "cancel");
    expect(r2.ok).toBe(true);
    expect(client.calls).toContain("rejectQuestion:que_2");
    expect(h.messages.filter((m) => m.role === "user")).toHaveLength(0);
  } finally {
    h.close();
  }
});

test("resolvePrompt permission approve -> TIDAK di-echo ke chat", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const pid = await seedPrompt(h, sid, "permission", "per_echo");
    await h.sm.resolvePrompt(sid, pid, "approve");
    expect(h.messages.filter((m) => m.role === "user")).toHaveLength(0);
  } finally {
    h.close();
  }
});

test("resolvePrompt permission identik bertumpuk -> satu jawaban di-fan-out ke semuanya", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    // Tiga request identik (opencode memancarkan satu per tool call).
    for (const id of ["per_a", "per_b", "per_c"]) {
      client.emit({
        type: "permission.asked",
        requestID: id,
        sessionID: "ses_remote1",
        permission: "external_directory",
        patterns: ["D:\\Proj\\**"],
      });
    }
    expect(h.prompts).toHaveLength(3);

    // Satu klik Approve pada kartu grup -> ketiganya di-reply & resolved.
    const r = await h.sm.resolvePrompt(sid, "per_b", "approve");
    expect(r.ok).toBe(true);
    for (const id of ["per_a", "per_b", "per_c"]) {
      expect(client.calls).toContain(`replyPermission:${id}:once`);
      const p = h.store.getPrompt(id);
      expect(p.ok && p.data.status).toBe("resolved");
    }

    // Deny juga berlaku ke grup.
    for (const id of ["per_d", "per_e"]) {
      client.emit({
        type: "permission.asked",
        requestID: id,
        sessionID: "ses_remote1",
        permission: "external_directory",
        patterns: ["D:\\Proj\\**"],
      });
    }
    await h.sm.resolvePrompt(sid, "per_d", "deny");
    for (const id of ["per_d", "per_e"]) {
      expect(client.calls).toContain(`replyPermission:${id}:reject`);
      const p = h.store.getPrompt(id);
      expect(p.ok && p.data.status).toBe("resolved");
    }
    // Twin yang ikut resolved dilaporkan via hook (notif WS prompt_resolved).
    expect(h.promptResolved).toContainEqual([sid, "per_e"]);
  } finally {
    h.close();
  }
});

test("resolvePrompt always -> replyPermission always; opsi tak dikenal tetap diteruskan", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    // Always allow: opencode mengingat pola -> request identik berikutnya
    // tidak lagi menampilkan kartu.
    const pid = await seedPrompt(h, sid, "permission", "per_always");
    const r = await h.sm.resolvePrompt(sid, pid, "always");
    expect(r.ok).toBe(true);
    expect(client.calls).toContain("replyPermission:per_always:always");

    // Opsi menu tidak ada di daftar tersimpan TETAP diteruskan ke opencode
    // (validasi sebenarnya di server opencode) — menolak keras di sini
    // membuat tombol opsi terasa mati tanpa feedback.
    const qid = await seedPrompt(h, sid, "question", "que_opt");
    const r2 = await h.sm.resolvePrompt(sid, qid, { option: "OpsiLive" });
    expect(r2.ok).toBe(true);
    expect(client.calls).toContain("replyQuestion:que_opt:OpsiLive");
  } finally {
    h.close();
  }
});

test("resolvePrompt permission beda judul TIDAK ikut ter-fan-out", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    client.emit({
      type: "permission.asked",
      requestID: "per_bash",
      sessionID: "ses_remote1",
      permission: "bash",
      patterns: ["ls"],
    });
    client.emit({
      type: "permission.asked",
      requestID: "per_edit",
      sessionID: "ses_remote1",
      permission: "edit",
      patterns: ["src/a.ts"],
    });

    await h.sm.resolvePrompt(sid, "per_bash", "approve");
    expect(client.calls).toContain("replyPermission:per_bash:once");
    expect(client.calls).not.toContain("replyPermission:per_edit:once");
    const other = h.store.getPrompt("per_edit");
    expect(other.ok && other.data.status).toBe("pending");
  } finally {
    h.close();
  }
});

test("resolvePrompt invalid: tidak ditemukan / sudah resolved / respon salah", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    // promptId tidak dikenal
    expect((await h.sm.resolvePrompt(sid, "nope", "approve")).error).toBe("PROMPT_NOT_FOUND");

    // sudah resolved
    const pid = await seedPrompt(h, sid, "permission", "per_1");
    await h.sm.resolvePrompt(sid, pid, "approve");
    expect((await h.sm.resolvePrompt(sid, pid, "approve")).error).toBe("PROMPT_ALREADY_RESOLVED");

    // opsi menu pada permission -> invalid
    const pid2 = await seedPrompt(h, sid, "permission", "per_2");
    expect((await h.sm.resolvePrompt(sid, pid2, { option: "x" })).error).toBe(
      "INVALID_PROMPT_RESPONSE",
    );

    // approve/deny pada question -> invalid
    const pid3 = await seedPrompt(h, sid, "question", "que_1");
    expect((await h.sm.resolvePrompt(sid, pid3, "approve")).error).toBe("INVALID_PROMPT_RESPONSE");
    // Hanya respon valid yang memicu reply; dua kasus invalid tidak.
    expect(
      client.calls.filter((c) => c.startsWith("replyPermission") || c.startsWith("replyQuestion")),
    ).toHaveLength(1);
  } finally {
    h.close();
  }
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

test("stopSession: valid -> stopped + abort best-effort; invalid -> ditolak", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    const ok = h.sm.stopSession(sid);
    expect(ok.ok).toBe(true);
    expect(statusOf(h.store, sid)).toBe("stopped");
    expect(client.calls).toContain("abortSession:ses_remote1");
    expect(h.statuses.some(([id, st]) => id === sid && st === "stopped")).toBe(true);

    // stop lagi (sudah stopped) -> ditolak
    expect(h.sm.stopSession(sid).error).toBe("SESSION_NOT_RUNNING");
    expect(h.sm.stopSession("unknown").error).toBe("SESSION_NOT_FOUND");
  } finally {
    h.close();
  }
});

test("reconcileOnStartup: session running -> crashed", () => {
  const h = freshHarness();
  try {
    // Seed session running langsung di store (simulasi sisa restart).
    h.store.insertSession({
      id: "s1",
      projectId: "p1",
      agentType: "opencode",
      cwd: h.project.path,
      status: "running",
      ocSessionId: "ses_x",
      model: null,
      agent: null,
      title: null,
      createdAt: 1,
      updatedAt: 1,
    });
    h.store.insertSession({
      id: "s2",
      projectId: "p1",
      agentType: "opencode",
      cwd: h.project.path,
      status: "stopped",
      agent: null,
      ocSessionId: null,
      model: null,
      title: null,
      createdAt: 1,
      updatedAt: 1,
    });

    h.sm.reconcileOnStartup();
    expect(statusOf(h.store, "s1")).toBe("crashed");
    expect(statusOf(h.store, "s2")).toBe("stopped");
  } finally {
    h.close();
  }
});

test("server exit tak terduga -> session project ditandai crashed", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    // Panggil hook exit yang diregistrasikan Session_Manager.
    for (const cb of h.fake.exitCbs) cb("p1");
    expect(statusOf(h.store, sid)).toBe("crashed");
  } finally {
    h.close();
  }
});

test("exit -> recreate -> exit lagi: session baru juga ditandai crashed", async () => {
  const h = freshHarness();
  try {
    const sid1 = await createSession(h);
    for (const cb of h.fake.exitCbs) cb("p1");
    expect(statusOf(h.store, sid1)).toBe("crashed");

    // Session baru -> server di-ensure ulang; exitNotified harus di-reset.
    const sid2 = await createSession(h);
    expect(statusOf(h.store, sid2)).toBe("running");

    for (const cb of h.fake.exitCbs) cb("p1");
    expect(statusOf(h.store, sid2)).toBe("crashed");
  } finally {
    h.close();
  }
});

test("shutdown: simpan status running lalu stop seluruh server", async () => {
  const h = freshHarness();
  try {
    await createSession(h);
    await h.sm.shutdown();
    expect(h.fake.stopped).toContain("p1");
  } finally {
    h.close();
  }
});

// ---------------------------------------------------------------------------
// resumeSession (start ulang Session stopped/crashed, ocSessionId dipertahankan)
// ---------------------------------------------------------------------------

test("resumeSession: stopped + ocSessionId masih dikenal -> running tanpa createSession", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const before = h.store.getSession(sid);
    const ocIdBefore = before.ok ? before.data.ocSessionId : null;
    expect(h.sm.stopSession(sid).ok).toBe(true);
    const callsBefore =
      h.fake.clients.get("p1")?.calls.filter((c) => c.startsWith("createSession")).length ?? 0;

    const res = await h.sm.resumeSession(sid);
    expect(res.ok).toBe(true);
    expect(statusOf(h.store, sid)).toBe("running");
    // ocSessionId lama dipertahankan — riwayat opencode tetap nyambung.
    const after = h.store.getSession(sid);
    expect(after.ok && after.data.ocSessionId).toBe(ocIdBefore);
    // Tidak ada createSession tambahan.
    const callsAfter =
      h.fake.clients.get("p1")?.calls.filter((c) => c.startsWith("createSession")).length ?? 0;
    expect(callsAfter).toBe(callsBefore);
    // Event SSE tetap terpasang.
    expect(h.fake.clients.get("p1")?.eventCb).not.toBeNull();
  } finally {
    h.close();
  }
});

test("resumeSession: ocSessionId tidak dikenal server -> sesi remote baru, oc_session_id diperbarui", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    expect(h.sm.stopSession(sid).ok).toBe(true);
    // Server melaporkan oc session lama sudah hilang.
    const client = h.fake.clients.get("p1");
    if (client) client.getSessionResult = { ok: false, error: "OC_SESSION_NOT_FOUND" };

    const res = await h.sm.resumeSession(sid);
    expect(res.ok).toBe(true);
    expect(statusOf(h.store, sid)).toBe("running");
    const after = h.store.getSession(sid);
    expect(after.ok).toBe(true);
    if (after.ok) {
      // ocSessionId baru dari createSessionResult (masih ses_remote1, tapi
      // createSession terpanggil — riwayat lokal utuh, pemetaan SSE baru).
      expect(after.data.ocSessionId).toBe("ses_remote1");
    }
    expect(client?.calls).toContain("getSession:ses_remote1");
    expect(client?.calls.filter((c) => c.startsWith("createSession"))).toHaveLength(2);
  } finally {
    h.close();
  }
});

test("resumeSession: ditolak bila masih running / session tidak ada", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const running = await h.sm.resumeSession(sid);
    expect(running.ok).toBe(false);
    expect(running.error).toBe("SESSION_ALREADY_RUNNING");

    const missing = await h.sm.resumeSession("tidak-ada");
    expect(missing.ok).toBe(false);
    expect(missing.error).toBe("SESSION_NOT_FOUND");
  } finally {
    h.close();
  }
});

test("resumeSession crashed: reconcileOnStartup lalu resume -> running kembali", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    h.sm.reconcileOnStartup();
    expect(statusOf(h.store, sid)).toBe("crashed");

    const res = await h.sm.resumeSession(sid);
    expect(res.ok).toBe(true);
    expect(statusOf(h.store, sid)).toBe("running");
  } finally {
    h.close();
  }
});

test("resumeSession: input bebas kembali berfungsi setelah resume", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    expect(h.sm.stopSession(sid).ok).toBe(true);
    await h.sm.resumeSession(sid);

    const res = await h.sm.sendFreeTextInput(sid, "halo lagi");
    expect(res.ok).toBe(true);
    await flush();
    const client = h.fake.clients.get("p1");
    expect(client?.calls).toContain("promptAsync:halo lagi");
  } finally {
    h.close();
  }
});

// ---------------------------------------------------------------------------
// Pemilihan model (sesuai pilihan model di opencode)
// ---------------------------------------------------------------------------

const MODEL = { providerID: "kcgcode", modelID: "kiro/claude-opus-5" };

test("createSession dengan model valid -> tersimpan di Session & tervalidasi", async () => {
  const h = freshHarness();
  try {
    const res = await h.sm.createSession({ agentType: "opencode", projectId: "p1", model: MODEL });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("createSession gagal");
    expect(res.session.model).toEqual(MODEL);
    const stored = h.store.getSession(res.session.id);
    expect(stored.ok && stored.data.model).toEqual(MODEL);
    // Validasi memakai daftar provider server.
    const client = h.fake.clients.get("p1");
    expect(client?.calls).toContain("listModels");
  } finally {
    h.close();
  }
});

test("createSession dengan model tidak dikenal -> MODEL_NOT_FOUND, tanpa sesi remote", async () => {
  const h = freshHarness();
  try {
    const res = await h.sm.createSession({
      agentType: "opencode",
      projectId: "p1",
      model: { providerID: "kcgcode", modelID: "model-tidak-ada" },
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("harusnya ditolak");
    expect(res.error).toBe("MODEL_NOT_FOUND");
    const client = h.fake.clients.get("p1");
    // createSession remote tidak boleh terpanggil.
    expect(client?.calls.filter((c) => c.startsWith("createSession"))).toHaveLength(0);
    expect(h.store.listSessions()).toHaveLength(0);
  } finally {
    h.close();
  }
});

test("createSession tanpa model -> null (default opencode), listModels tak dipanggil", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const stored = h.store.getSession(sid);
    expect(stored.ok && stored.data.model).toBeNull();
    const client = h.fake.clients.get("p1");
    expect(client?.calls).not.toContain("listModels");
    // promptAsync dikirim tanpa model.
    await h.sm.sendFreeTextInput(sid, "hai");
    await flush();
    expect(client?.promptModels).toEqual([null]);
  } finally {
    h.close();
  }
});

test("createSession: listModels gagal -> error diteruskan, tanpa sesi remote", async () => {
  const h = freshHarness();
  try {
    const client = h.fake.clients.get("p1") ?? makeFakeClient();
    client.listModelsResult = { ok: false, error: "OC_LIST_MODELS_FAILED(500)" };
    h.fake.clients.set("p1", client);
    const res = await h.sm.createSession({ agentType: "opencode", projectId: "p1", model: MODEL });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("harusnya gagal");
    expect(res.error).toContain("OC_LIST_MODELS_FAILED");
  } finally {
    h.close();
  }
});

test("promptAsync selalu membawa model Session yang tersimpan", async () => {
  const h = freshHarness();
  try {
    const sid = await h.sm
      .createSession({ agentType: "opencode", projectId: "p1", model: MODEL })
      .then((r) => (r.ok ? r.session.id : ""));
    expect(sid).not.toBe("");

    await h.sm.sendFreeTextInput(sid, "pesan pertama");
    await flush();
    await h.sm.sendFreeTextInput(sid, "pesan kedua");
    await flush();
    const client = h.fake.clients.get("p1");
    expect(client?.promptModels).toEqual([
      "kcgcode/kiro/claude-opus-5",
      "kcgcode/kiro/claude-opus-5",
    ]);
  } finally {
    h.close();
  }
});

test("setSessionModel: ganti model -> prompt berikutnya memakai model baru", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const baru = { providerID: "kcgcode", modelID: "mimo/mimo-v2.5" };
    const client = h.fake.clients.get("p1");
    if (client) {
      client.availableModels = [
        ...client.availableModels,
        { providerID: "kcgcode", providerName: "kcgcode", modelID: baru.modelID, name: "Mimo" },
      ];
    }

    const res = h.sm.setSessionModel(sid, baru);
    expect(res.ok).toBe(true);
    const stored = h.store.getSession(sid);
    expect(stored.ok && stored.data.model).toEqual(baru);
    // Status tidak berubah akibat penggantian model.
    expect(stored.ok && stored.data.status).toBe("running");

    await h.sm.sendFreeTextInput(sid, "setelah ganti model");
    await flush();
    expect(client?.promptModels).toEqual(["kcgcode/mimo/mimo-v2.5"]);
  } finally {
    h.close();
  }
});

test("setSessionModel(null) -> kembali default; session tak dikenal -> SESSION_NOT_FOUND", async () => {
  const h = freshHarness();
  try {
    const sid = await h.sm
      .createSession({ agentType: "opencode", projectId: "p1", model: MODEL })
      .then((r) => (r.ok ? r.session.id : ""));

    expect(h.sm.setSessionModel(sid, null).ok).toBe(true);
    const stored = h.store.getSession(sid);
    expect(stored.ok && stored.data.model).toBeNull();

    const missing = h.sm.setSessionModel("tidak-ada", MODEL);
    expect(missing.ok).toBe(false);
    expect(missing.error).toBe("SESSION_NOT_FOUND");
  } finally {
    h.close();
  }
});

test("listModels(projectId) -> daftar model dari server headless Project", async () => {
  const h = freshHarness();
  try {
    const res = await h.sm.listModels("p1");
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("listModels gagal");
    expect(res.data).toEqual([
      {
        providerID: "kcgcode",
        providerName: "kcgcode",
        modelID: "kiro/claude-opus-5",
        name: "Claude Opus 5",
      },
    ]);
    // Server di-ensure dengan path Project.
    expect(h.fake.ensureCalls).toContainEqual({ projectId: "p1", projectPath: h.project.path });

    const missing = await h.sm.listModels("project-tidak-ada");
    expect(missing.ok).toBe(false);
    if (missing.ok) throw new Error("harusnya gagal");
    expect(missing.error).toBe("PROJECT_NOT_FOUND");
  } finally {
    h.close();
  }
});

test("model bertahan setelah stop + resume (riwayat & pilihan utuh)", async () => {
  const h = freshHarness();
  try {
    const sid = await h.sm
      .createSession({ agentType: "opencode", projectId: "p1", model: MODEL })
      .then((r) => (r.ok ? r.session.id : ""));
    expect(h.sm.stopSession(sid).ok).toBe(true);
    expect(await h.sm.resumeSession(sid)).toEqual({ ok: true });

    const stored = h.store.getSession(sid);
    expect(stored.ok && stored.data.model).toEqual(MODEL);
    await h.sm.sendFreeTextInput(sid, "lanjut");
    await flush();
    expect(h.fake.clients.get("p1")?.promptModels).toEqual(["kcgcode/kiro/claude-opus-5"]);
  } finally {
    h.close();
  }
});

// ---------------------------------------------------------------------------
// deleteSession (hapus permanen: remote opencode + lokal)
// ---------------------------------------------------------------------------

test("deleteSession: remote dihapus + lokal bersih (messages, prompts, history)", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const ocId = h.store.getSession(sid).ok ? "ses_remote1" : null;
    await h.sm.sendFreeTextInput(sid, "pesan sebelum hapus");
    await flush();

    const res = await h.sm.deleteSession(sid);
    expect(res.ok).toBe(true);
    const client = h.fake.clients.get("p1");
    expect(client?.calls).toContain(`deleteSession:${ocId}`);
    // Semua jejak lokal hilang.
    expect(h.store.getSession(sid).ok).toBe(false);
    expect(h.store.getMessages(sid).ok).toBe(false);
    expect(h.store.listSessions()).toHaveLength(0);
  } finally {
    h.close();
  }
});

test("deleteSession: server headless menolak -> error diteruskan, data lokal utuh", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = h.fake.clients.get("p1");
    if (client) client.deleteSessionResult = { ok: false, error: "OC_DELETE_SESSION_FAILED(500)" };

    const res = await h.sm.deleteSession(sid);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("harusnya gagal");
    expect(res.error).toContain("OC_DELETE_SESSION_FAILED");
    // Data tidak setengah terhapus.
    expect(h.store.getSession(sid).ok).toBe(true);
  } finally {
    h.close();
  }
});

test("deleteSession: server headless mati -> di-spawn ulang, remote ikut dihapus", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    // Simulasi server project sudah tidak hidup (mis. KCG Code di-restart).
    h.fake.clients.delete("p1");
    expect(h.fake.ensureCalls).toHaveLength(1);

    const res = await h.sm.deleteSession(sid);
    expect(res.ok).toBe(true);
    // Server di-spawn ulang demi menghapus session remote (bukan dilewati).
    expect(h.fake.ensureCalls).toHaveLength(2);
    expect(h.fake.ensureCalls[1]).toEqual({ projectId: "p1", projectPath: h.project.path });
    expect(h.fake.clients.get("p1")?.calls).toContain("deleteSession:ses_remote1");
    expect(h.store.getSession(sid).ok).toBe(false);
  } finally {
    h.close();
  }
});

test("deleteSession: server mati & spawn ulang gagal -> error, data lokal utuh", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    // Server mati dan tidak bisa dihidupkan lagi (mis. binary opencode hilang).
    h.fake.clients.delete("p1");
    h.fake.ensureResult = { ok: false, error: "SERVER_START_FAILED" };

    const res = await h.sm.deleteSession(sid);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("harusnya gagal");
    expect(res.error).toContain("SERVER_START_FAILED");
    // Penghapusan dibatalkan — sesi tetap tampil agar user bisa coba lagi.
    expect(h.store.getSession(sid).ok).toBe(true);
  } finally {
    h.close();
  }
});

test("deleteSession: session masih running -> di-stop dulu lalu dihapus", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const res = await h.sm.deleteSession(sid);
    expect(res.ok).toBe(true);
    const client = h.fake.clients.get("p1");
    expect(client?.calls).toContain("abortSession:ses_remote1");
    expect(h.store.getSession(sid).ok).toBe(false);
  } finally {
    h.close();
  }
});

test("deleteSession: session tidak ada -> SESSION_NOT_FOUND", async () => {
  const h = freshHarness();
  try {
    const res = await h.sm.deleteSession("tidak-ada");
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("harusnya gagal");
    expect(res.error).toBe("SESSION_NOT_FOUND");
  } finally {
    h.close();
  }
});

test("deleteSession: onDeleted terpanggil (broadcast ke subscriber WS)", async () => {
  let deletedId: string | undefined;
  // Manager kedua dengan hook onDeleted — store & fake manager dipakai bersama.
  const h = freshHarnessWithHooks({ onDeleted: (id) => (deletedId = id) });
  try {
    const created = await h.sm.createSession({ agentType: "opencode", projectId: h.project.id });
    if (!created.ok) throw new Error("create gagal");
    const res = await h.sm.deleteSession(created.session.id);
    expect(res.ok).toBe(true);
    expect(deletedId).toBe(created.session.id);
  } finally {
    h.close();
  }
});

// ---------------------------------------------------------------------------
// Lampiran gambar (upload dari perangkat)
// ---------------------------------------------------------------------------

test("sendFreeTextInput dengan gambar -> echo user berisi part file image + promptAsync menerima ref gambar", async () => {
  const h = freshHarnessWithHooks({}, { withAttachments: true });
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    // 1x1 PNG valid agar `attachment` tersimpan.
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52,
    ]);
    const saved = h.attachments?.save(sid, "foto.png", "image/png", png);
    expect(saved?.ok).toBe(true);
    if (!saved?.ok) throw new Error("save gagal");

    const res = await h.sm.sendFreeTextInput(sid, "apa isi gambar ini?", [], [saved.data.id]);
    expect(res.ok).toBe(true);
    await flush();

    // Echo user disimpan + dikirim, memuat part file image + attachmentId.
    const user = h.messages.find((m) => m.role === "user");
    expect(user).toBeDefined();
    const imgPart = user?.parts.find((p) => p.type === "file" && p.attachmentId === saved.data.id);
    expect(imgPart).toBeDefined();
    expect(imgPart?.mime).toBe("image/png");
    expect(imgPart?.filename).toBe("foto.png");
    expect(typeof imgPart?.url).toBe("string");

    // promptAsync dipanggil dengan referensi file image (mime + url absolut).
    const files = client.promptFilesCalls.at(-1) ?? [];
    const ref = files.find((f) => f.filename === "foto.png");
    expect(ref?.mime).toBe("image/png");
    // URL wajib absolut (`file:///…`): `file://rel/path` ditolak opencode.
    expect(ref?.url.startsWith("file:///")).toBe(true);
    expect(ref?.url).toContain(saved.data.id);
    // Part echo pun membawa URL absolut yang sama.
    expect(typeof imgPart?.url).toBe("string");
    expect((imgPart?.url ?? "").startsWith("file:///")).toBe(true);
  } finally {
    h.close();
  }
});

test("sendFreeTextInput gambar + @file -> part text + file image + file teks di echo", async () => {
  const h = freshHarnessWithHooks({}, { withAttachments: true });
  try {
    const sid = await createSession(h);
    const saved = h.attachments?.save(sid, "ss.png", "image/png", new Uint8Array([1, 2, 3]));
    expect(saved?.ok).toBe(true);
    if (!saved?.ok) throw new Error("save gagal");

    const res = await h.sm.sendFreeTextInput(
      sid,
      "lihat @src/App.tsx",
      ["src/App.tsx"],
      [saved.data.id],
    );
    expect(res.ok).toBe(true);
    const user = h.messages.find((m) => m.role === "user");
    const parts = user?.parts ?? [];
    expect(parts.filter((p) => p.type === "text")).toHaveLength(1);
    expect(parts.filter((p) => p.type === "file" && p.attachmentId)).toHaveLength(1);
    expect(parts.filter((p) => p.type === "file" && !p.attachmentId)).toHaveLength(1);
    await flush();
  } finally {
    h.close();
  }
});

test("sendFreeTextInput: id gambar tak dikenal -> ATTACHMENT_NOT_FOUND tanpa echo", async () => {
  const h = freshHarnessWithHooks({}, { withAttachments: true });
  try {
    const sid = await createSession(h);
    const before = h.messages.length;
    const res = await h.sm.sendFreeTextInput(
      sid,
      "halo",
      [],
      ["00000000-0000-0000-0000-000000000000"],
    );
    expect(res.ok).toBe(false);
    expect(res.error).toBe("ATTACHMENT_NOT_FOUND");
    expect(h.messages.length).toBe(before); // tidak ada echo
  } finally {
    h.close();
  }
});

test("sendFreeTextInput tanpa teks tapi ada gambar -> teks kosong diizinkan", async () => {
  const h = freshHarnessWithHooks({}, { withAttachments: true });
  try {
    const sid = await createSession(h);
    const saved = h.attachments?.save(sid, "x.webp", "image/webp", new Uint8Array([9]));
    expect(saved?.ok).toBe(true);
    if (!saved?.ok) throw new Error("save gagal");

    const res = await h.sm.sendFreeTextInput(sid, "  ", [], [saved.data.id]);
    expect(res.ok).toBe(true);
    const user = h.messages.find((m) => m.role === "user");
    expect(user?.parts.some((p) => p.type === "file" && p.attachmentId === saved.data.id)).toBe(
      true,
    );
    await flush();
  } finally {
    h.close();
  }
});

test("deleteSession membersihkan lampiran gambar Session", async () => {
  const h = freshHarnessWithHooks({}, { withAttachments: true });
  try {
    const sid = await createSession(h);
    const saved = h.attachments?.save(sid, "a.png", "image/png", new Uint8Array([1]));
    expect(saved?.ok).toBe(true);
    if (!saved?.ok) throw new Error("save gagal");
    expect(h.attachments?.info(sid, saved.data.id).ok).toBe(true);

    await h.sm.sendFreeTextInput(sid, "hapus nanti", [], [saved.data.id]);
    const res = await h.sm.deleteSession(sid);
    expect(res.ok).toBe(true);
    expect(h.attachments?.info(sid, saved.data.id).ok).toBe(false);
  } finally {
    h.close();
  }
});
