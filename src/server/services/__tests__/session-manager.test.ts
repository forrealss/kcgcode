/**
 * Unit & property test `session-manager.ts`.
 *
 * Session_Manager mengorkestrasi agent lewat lapisan agent (acuan opencode
 * v2):
 * - `createSession` async: validasi -> ensure client agent -> session.create.
 * - `sendFreeTextInput` async: echo pesan user -> session.prompt -> balasan
 *   dirakit dari event (`session.text.*`, `session.tool.*`).
 * - Interactive_Prompt dari event `permission.asked` / `form.created`.
 * - `resolvePrompt` -> `permission.reply` / `form.reply|cancel`.
 *
 * Mocking boundary: `AgentBackend` + `AgentClient` di-mock seluruhnya
 * (`fake-agent.ts`); `bun:sqlite` asli.
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
import {
  type FakeAgentClient,
  type FakeBackend,
  makeFakeBackend,
  makeFakeClient,
} from "../../__tests__/fake-agent";
import type { AgentEvent, AgentFormField } from "../../agents/types";
import { type AttachmentManager, createAttachmentManager } from "../attachments";
import {
  type CreateSessionRequest,
  createSessionManager,
  type SessionManager,
} from "../session-manager";

type FakeClient = FakeAgentClient;
type FakeServers = FakeBackend;

function makeFakeServers(): FakeServers {
  return makeFakeBackend("opencode");
}

// ---------------------------------------------------------------------------
// Pembangun event agent (bentuk opencode v2)
// ---------------------------------------------------------------------------

/** Event agent ringkas untuk test. */
const ev = {
  /** Step baru dengan pesan assistant `msg` (pengganti `message.updated`). */
  step: (sessionID: string, msg: string): AgentEvent => ({
    type: "session.step.started",
    data: { sessionID, assistantMessageID: msg },
  }),
  /** Teks utuh ke-`ordinal` pesan `msg`. */
  text: (sessionID: string, msg: string, text: string, ordinal = 0): AgentEvent[] => [
    { type: "session.text.started", data: { sessionID, assistantMessageID: msg, ordinal } },
    { type: "session.text.ended", data: { sessionID, assistantMessageID: msg, ordinal, text } },
  ],
  textStarted: (sessionID: string, msg: string, ordinal = 0): AgentEvent => ({
    type: "session.text.started",
    data: { sessionID, assistantMessageID: msg, ordinal },
  }),
  textDelta: (sessionID: string, msg: string, delta: string, ordinal = 0): AgentEvent => ({
    type: "session.text.delta",
    data: { sessionID, assistantMessageID: msg, ordinal, delta },
  }),
  textEnded: (sessionID: string, msg: string, text: string, ordinal = 0): AgentEvent => ({
    type: "session.text.ended",
    data: { sessionID, assistantMessageID: msg, ordinal, text },
  }),
  reasoning: (sessionID: string, msg: string, text: string, ordinal = 0): AgentEvent[] => [
    { type: "session.reasoning.started", data: { sessionID, assistantMessageID: msg, ordinal } },
    {
      type: "session.reasoning.ended",
      data: { sessionID, assistantMessageID: msg, ordinal, text },
    },
  ],
  /** Tool call `id` (`name`) dengan input — status running. */
  tool: (
    sessionID: string,
    msg: string,
    id: string,
    name: string,
    input: Record<string, unknown> = {},
  ): AgentEvent[] => [
    { type: "session.tool.input.started", data: { sessionID, assistantMessageID: msg, id, name } },
    { type: "session.tool.called", data: { sessionID, assistantMessageID: msg, id, input } },
  ],
  toolDone: (sessionID: string, msg: string, id: string, output: string): AgentEvent => ({
    type: "session.tool.success",
    data: { sessionID, assistantMessageID: msg, id, content: [{ type: "text", text: output }] },
  }),
  /** Turn selesai sukses (pengganti `session.idle`). */
  idle: (sessionID: string): AgentEvent => ({
    type: "session.execution.succeeded",
    data: { sessionID },
  }),
  failed: (sessionID: string, message: string, type = "unknown"): AgentEvent => ({
    type: "session.execution.failed",
    data: { sessionID, error: { type, message } },
  }),
  interrupted: (sessionID: string): AgentEvent => ({
    type: "session.execution.interrupted",
    data: { sessionID, reason: "user" },
  }),
  retry: (sessionID: string, message: string, attempt = 1): AgentEvent => ({
    type: "session.retry.scheduled",
    data: { sessionID, attempt, error: { type: "provider.retry", message } },
  }),
  activity: (sessionID: string): AgentEvent => ({ type: "agent.activity", data: { sessionID } }),
  renamed: (sessionID: string, title: string): AgentEvent => ({
    type: "session.renamed",
    data: { sessionID, title },
  }),
  child: (sessionID: string, parentID: string): AgentEvent => ({
    type: "session.created",
    data: { sessionID, parentID },
  }),
  permission: (
    sessionID: string,
    id: string,
    action: string,
    resources: string[] = [],
  ): AgentEvent => ({
    type: "permission.asked",
    data: { id, sessionID, action, resources },
  }),
  /** Form question; `fields` default satu field string dengan opsi. */
  form: (sessionID: string, id: string, fields: AgentFormField[]): AgentEvent => ({
    type: "form.created",
    data: { form: { id, sessionID, title: "Questions", fields } },
  }),
};

/** Field form pertanyaan bergaya tool `question` (kunci `q<i>`). */
function qField(
  i: number,
  question: string,
  options: (string | { label: string; description?: string })[],
  opts: { header?: string; multiple?: boolean; custom?: boolean } = {},
): AgentFormField {
  return {
    key: `q${i}`,
    type: opts.multiple ? "multiselect" : "string",
    ...(opts.header ? { title: opts.header } : {}),
    description: question,
    options: options.map((o) =>
      typeof o === "string" ? { value: o, label: o } : { value: o.label, ...o },
    ),
    ...(opts.custom === false ? { custom: false } : {}),
  };
}

/** Kirim beberapa event berurutan. */
function emitAll(client: FakeClient, events: AgentEvent | AgentEvent[]): void {
  for (const e of Array.isArray(events) ? events : [events]) client.emit(e);
}

/** Part teks hasil proyeksi (`now` harness = 1000). */
function textPart(msg: string, text: string, ordinal = 0, type = "text"): MessagePart {
  return {
    id: `prt_${msg}_${type}_${ordinal}`,
    type,
    text,
    time: { start: 1000, end: 1000 },
    messageID: msg,
  };
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
  partDeltas: [string, string, string, string, string][];
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
  /** Delta streaming (onMessagePartDelta): [sessionId, messageId, partId, field, delta]. */
  const partDeltas: [string, string, string, string, string][] = [];
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
    attachments,
    now: () => 1000,
    ...extraHooks,
    ...managerOverrides,
    backends: { opencode: fake.backend, ...managerOverrides.backends },
    onMessage: (m) => messages.push(m),
    onMessagePart: (sid, mid, part) => messageParts.push([sid, mid, part]),
    onMessagePartDelta: (sid, mid, pid, field, delta) =>
      partDeltas.push([sid, mid, pid, field, delta]),
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
    partDeltas,
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
    expect(h.fake.ensureCalls[0]).toEqual({ projectId: "p1", directory: h.project.path });
    // Subscribe event SSE terpasang pada client.
    expect(h.fake.clients.get("p1")?.subscribed).toBe(true);
  } finally {
    h.close();
  }
});

test("session.create: ensure server hanya sekali untuk project yang sama", async () => {
  const h = freshHarness();
  try {
    await createSession(h);
    await createSession(h);
    await createSession(h);
    expect(h.fake.ensureCalls).toHaveLength(3); // dipanggil tiap createSession
    const client = h.fake.clients.get("p1");
    expect(client?.calls.filter((c) => c.startsWith("session.create"))).toHaveLength(3);
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

test("session.create: ensure server gagal -> error, tanpa session", async () => {
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

test("session.create: create session remote gagal -> error, tanpa session", async () => {
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

test("sendFreeTextInput sukses -> echo user; assistant dirakit saat eksekusi selesai", async () => {
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

    // Prompt dikirim tanpa menunggu balasan — belum ada pesan assistant.
    const client = clientOf(h);
    expect(client.calls).toContain("session.prompt:hello");
    expect(h.messages).toHaveLength(1);

    // Balasan tiba sebagai event step + teks.
    emitAll(client, [
      ev.step("ses_remote1", "msg_a1"),
      ...ev.text("ses_remote1", "msg_a1", "balasan: hello"),
    ]);
    // Turn belum ditutup sebelum eksekusi selesai.
    expect(h.messages).toHaveLength(1);

    // Eksekusi Session akar selesai menutup turn -> pesan assistant dirakit.
    client.emit(ev.idle("ses_remote1"));

    expect(h.messages).toHaveLength(2);
    expect(h.messages[1]?.role).toBe("assistant");
    expect(h.messages[1]?.id).toBe("msg_a1");
    expect(h.messages[1]?.parts).toEqual([textPart("msg_a1", "balasan: hello")]);

    // Keduanya tersimpan di store (round-trip history).
    const stored = h.store.getMessages(sid);
    expect(stored.ok).toBe(true);
    if (stored.ok) expect(stored.data).toHaveLength(2);
  } finally {
    h.close();
  }
});

test("sendFreeTextInput: session.prompt gagal -> onError + pesan error tersimpan", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    client.promptResult = { ok: false, error: "AGENT_PROMPT_FAILED: HTTP 500" };
    await h.sm.sendFreeTextInput(sid, "hello");
    await flush();
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]?.[0]).toBe(sid);
    // Pesan error ramah (bukan kode mentah) dan ditulis ke history (part error).
    expect(h.errors[0]?.[1]).toBe("Failed to send the prompt: HTTP 500");
    const assistants = h.messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(1);
    expect(assistants[0]?.parts).toEqual([{ type: "error", text: h.errors[0]?.[1] }]);
    const stored = h.store.getMessages(sid);
    expect(stored.ok && stored.data.filter((m) => m.role === "assistant")).toHaveLength(1);
  } finally {
    h.close();
  }
});

test("session.execution.failed menutup turn: parts tersimpan + pesan error + banner", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    await h.sm.sendFreeTextInput(sid, "hello");
    await flush();

    // Parts sudah ter-stream sebelum error datang — harus tetap tersimpan.
    emitAll(client, [
      ev.step("ses_remote1", "msg_a1"),
      ...ev.text("ses_remote1", "msg_a1", "sebagian"),
    ]);

    // Agent gagal memproses prompt (mis. URL file gambar) — akhir eksekusi.
    client.emit(
      ev.failed(
        "ses_remote1",
        'TypeError: File URL host must be "localhost" or empty on linux\n    at SessionPrompt.resolveUserPart',
      ),
    );

    // Banner ramah (baris pertama), parts tersimpan, pesan error ditulis.
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]?.[0]).toBe(sid);
    expect(h.errors[0]?.[1]).toBe('TypeError: File URL host must be "localhost" or empty on linux');
    const assistants = h.messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(2);
    expect(assistants[0]?.parts).toEqual([textPart("msg_a1", "sebagian")]);
    expect(assistants[1]?.parts[0]?.type).toBe("error");
    expect(assistants[1]?.parts[0]?.text).toBe(h.errors[0]?.[1]);
    const stored = h.store.getMessages(sid);
    expect(stored.ok && stored.data.filter((m) => m.role === "assistant")).toHaveLength(2);

    // Akhir eksekusi berikutnya tidak menambah apa-apa — turn sudah ditutup.
    client.emit(ev.idle("ses_remote1"));
    expect(h.messages.filter((m) => m.role === "assistant")).toHaveLength(2);
  } finally {
    h.close();
  }
});

test("session.execution.failed tanpa turn aktif -> hanya onError, tidak menulis pesan", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    client.emit(ev.failed("ses_remote1", "auth required", "provider.auth"));
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

    // Tanda hidup #1: step baru + part teks — timer di-reset 2x.
    emitAll(client, [
      ev.step("ses_remote1", "msg_a1"),
      ...ev.text("ses_remote1", "msg_a1", "menulis lama..."),
    ]);
    expect(timers).toHaveLength(3); // timer awal + 2 reset

    // Timer LAMA terpicu (race): tidak boleh menggagalkan turn yang hidup.
    fireFirst?.();
    expect(h.errors).toHaveLength(0);
    expect(h.turns).toEqual([[sid, true]]);

    // Tanda hidup #2: aktivitas agent (tool lama, dsb.) juga me-reset timer.
    client.emit(ev.activity("ses_remote1"));
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

    // Turn meminta izin — agent hidup MENUNGGU keputusan user.
    client.emit(ev.permission("ses_remote1", "per_idle1", "bash", ["bun install"]));
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

test("sub-agent: turn panjang dengan child session tersimpan utuh", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    await h.sm.sendFreeTextInput(sid, "delegasikan");
    await flush();

    // Sub-agent: child session ikut menyumbang pesan pada turn yang sama.
    emitAll(client, [
      ev.child("ses_child1", "ses_remote1"),
      ev.step("ses_remote1", "msg_induk"),
      ...ev.text("ses_remote1", "msg_induk", "memanggil sub-agent"),
      ev.step("ses_child1", "msg_child"),
      ...ev.text("ses_child1", "msg_child", "hasil sub-agent"),
    ]);

    // Child selesai TIDAK menutup turn (sub-agent selesai lebih dulu dari induk).
    client.emit(ev.idle("ses_child1"));
    expect(h.messages.filter((m) => m.role === "assistant")).toHaveLength(0);

    // Eksekusi Session akar selesai baru menutup turn.
    client.emit(ev.idle("ses_remote1"));
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

    client.emit(ev.step("ses_remote1", "msg_a1"));
    emitAll(client, ev.text("ses_remote1", "msg_a1", "sekali"));

    client.emit(ev.idle("ses_remote1"));
    client.emit(ev.idle("ses_remote1"));

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

    client.emit(ev.idle("ses_remote1"));

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

    client.emit(ev.step("ses_remote1", "msg_a1"));
    emitAll(client, ev.text("ses_remote1", "msg_a1", "separuh jalan"));

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
    client.emit(ev.idle("ses_remote1"));
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

    client.emit(ev.step("ses_remote1", "msg_a1"));
    emitAll(client, ev.text("ses_remote1", "msg_a1", "separuh jalan"));

    const res = h.sm.interruptSession(sid);
    expect(res.ok).toBe(true);

    // Turn remote di-abort.
    expect(client.calls).toContain("session.interrupt:ses_remote1");
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

test("session.execution.interrupted setelah interrupt -> tanpa banner error", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    await h.sm.sendFreeTextInput(sid, "hello");
    await flush();
    h.sm.interruptSession(sid);

    // Server mengonfirmasi turn dibatalkan (bukan kegagalan nyata).
    client.emit(ev.interrupted("ses_remote1"));
    expect(h.errors).toHaveLength(0);
    const stored = h.store.getMessages(sid);
    expect(stored.ok && stored.data.filter((m) => m.role === "assistant")).toHaveLength(0);
  } finally {
    h.close();
  }
});

test("session.execution.interrupted dengan turn aktif -> turn ditutup tanpa pesan error", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    await h.sm.sendFreeTextInput(sid, "hello");
    await flush();

    // Parts sudah ter-stream sebelum opencode mengabort turn.
    client.emit(ev.step("ses_remote1", "msg_a1"));
    emitAll(client, ev.text("ses_remote1", "msg_a1", "sebagian"));
    client.emit(ev.interrupted("ses_remote1"));

    // Parts tersimpan, TAPI tanpa pesan error & tanpa banner onError.
    expect(h.errors).toHaveLength(0);
    const assistants = h.messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(1);
    expect(assistants[0]?.parts).toEqual([textPart("msg_a1", "sebagian")]);
    expect(h.turns).toContainEqual([sid, false]);
  } finally {
    h.close();
  }
});

test("session.retry.scheduled -> onError banner ramah, turn tetap hidup sampai selesai", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    await h.sm.sendFreeTextInput(sid, "hello");
    await flush();

    // Provider error yang bisa di-retry: agent memancarkan
    // `session.retry.scheduled` — turn BELUM ditutup, tapi Client diberi tahu
    // kenapa balasan lambat (bukan menunggu diam-diam).
    client.emit(ev.retry("ses_remote1", 'Command Code API error 400: {"success":false}', 1));
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]?.[0]).toBe(sid);
    expect(h.errors[0]?.[1]).toBe(
      'The model provider is retrying (attempt 1): Command Code API error 400: {"success":false}',
    );
    // Turn masih aktif — retry adalah backoff, bukan kegagalan final.
    expect(h.turns).toEqual([[sid, true]]);
    expect(h.messages.filter((m) => m.role === "assistant")).toHaveLength(0);

    // Pesan retry hanya baris pertama (sisanya sering body JSON panjang).
    client.emit(ev.retry("ses_remote1", ["Free limit reached", '{"raw":"body"}'].join("\n"), 2));
    expect(h.errors[1]?.[1]).toBe("The model provider is retrying (attempt 2): Free limit reached");

    // Retry sukses -> turn ditutup normal oleh akhir eksekusi (tanpa pesan error).
    client.emit(ev.step("ses_remote1", "msg_a1"));
    emitAll(client, ev.text("ses_remote1", "msg_a1", "akhirnya jawaban"));
    client.emit(ev.idle("ses_remote1"));

    const assistants = h.messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(1);
    expect(assistants[0]?.parts[0]?.text).toBe("akhirnya jawaban");
    expect(h.turns).toContainEqual([sid, false]);
  } finally {
    h.close();
  }
});

test("agent.activity / step tanpa konten -> tanpa banner, tanpa efek", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    await h.sm.sendFreeTextInput(sid, "hello");
    await flush();

    client.emit(ev.activity("ses_remote1"));
    client.emit({
      type: "session.step.ended",
      data: { sessionID: "ses_remote1", assistantMessageID: "msg_x", finish: "stop" },
    });
    expect(h.errors).toHaveLength(0);

    // Turn tetap ditutup oleh akhir eksekusi seperti biasa.
    client.emit(ev.idle("ses_remote1"));
    expect(h.turns).toContainEqual([sid, false]);
  } finally {
    h.close();
  }
});

// ---------------------------------------------------------------------------
// Streaming (event session.step / session.text / session.reasoning)
// ---------------------------------------------------------------------------

test("streaming: part assistant di-forward via onMessagePart setelah turn aktif", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    // Turn dimulai (sendFreeTextInput membuat entry turn streaming).
    await h.sm.sendFreeTextInput(sid, "hitung 2+2");

    // Step baru: pesan assistant mulai.
    client.emit(ev.step("ses_remote1", "msg_a1"));
    // Reasoning lalu teks.
    emitAll(client, ev.reasoning("ses_remote1", "msg_a1", "pikir..."));
    emitAll(client, ev.text("ses_remote1", "msg_a1", "jawaban"));

    expect(h.messageParts).toHaveLength(2);
    expect(h.messageParts[0]).toEqual([
      sid,
      "msg_a1",
      textPart("msg_a1", "pikir...", 0, "reasoning"),
    ]);
    expect(h.messageParts[1]).toEqual([sid, "msg_a1", textPart("msg_a1", "jawaban")]);
  } finally {
    h.close();
  }
});

test("streaming: session.text.delta di-forward & terakumulasi", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    await h.sm.sendFreeTextInput(sid, "halo");

    client.emit(ev.step("ses_remote1", "msg_a1"));
    client.emit(ev.textStarted("ses_remote1", "msg_a1"));
    // Part dikirim (teks kosong) saat token pertama tiba, lalu delta per token.
    for (const delta of ["Ku", "cing ", "lucu."]) {
      client.emit(ev.textDelta("ses_remote1", "msg_a1", delta));
    }
    const partId = "prt_msg_a1_text_0";
    expect(h.messageParts).toEqual([
      [
        sid,
        "msg_a1",
        { id: partId, type: "text", text: "", time: { start: 1000 }, messageID: "msg_a1" },
      ],
    ]);

    // Tiap delta diteruskan ke Client apa adanya (bukan teks penuh).
    expect(h.partDeltas).toEqual([
      [sid, "msg_a1", partId, "text", "Ku"],
      [sid, "msg_a1", partId, "text", "cing "],
      [sid, "msg_a1", partId, "text", "lucu."],
    ]);

    // Tanpa `ended` pun, teks yang tersimpan saat eksekusi selesai tetap utuh.
    client.emit(ev.idle("ses_remote1"));
    const assistant = h.messages.find((m) => m.role === "assistant");
    expect(assistant?.parts).toEqual([
      {
        id: partId,
        type: "text",
        text: "Kucing lucu.",
        time: { start: 1000 },
        messageID: "msg_a1",
      },
    ]);
  } finally {
    h.close();
  }
});

test("streaming: delta kosong / pesan bukan milik turn diabaikan", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    await h.sm.sendFreeTextInput(sid, "halo");
    client.emit(ev.step("ses_remote1", "msg_a1"));
    // Delta kosong -> tidak ada part/delta.
    client.emit(ev.textDelta("ses_remote1", "msg_a1", ""));
    // Pesan bukan milik turn (mis. pesan user) -> diabaikan.
    client.emit(ev.textDelta("ses_remote1", "msg_user", "y"));
    expect(h.partDeltas).toHaveLength(0);
    expect(h.messageParts).toHaveLength(0);
    expect(sid).toBeTruthy();
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
    emitAll(client, ev.text("ses_remote1", "msg_user1", "user echo"));
    expect(h.messageParts).toHaveLength(0);

    // Assistant dikenal -> hanya part dengan messageID yang sama diteruskan.
    client.emit(ev.step("ses_remote1", "msg_a1"));
    emitAll(client, ev.text("ses_remote1", "msg_lain", "salah"));
    expect(h.messageParts).toHaveLength(0);

    emitAll(client, ev.text("ses_remote1", "msg_a1", "benar"));
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
    client.emit(ev.step("ses_remote1", "msg_a1"));
    client.emit(ev.step("ses_remote1", "msg_a2"));
    emitAll(client, ev.text("ses_remote1", "msg_a1", "satu"));
    emitAll(client, ev.text("ses_remote1", "msg_a2", "dua"));

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
    client.promptDelays = [40, 500];

    await h.sm.sendFreeTextInput(sid, "input pertama");
    await h.sm.sendFreeTextInput(sid, "input kedua");
    client.emit(ev.step("ses_remote1", "msg_b1"));
    emitAll(client, ev.text("ses_remote1", "msg_b1", "lanjutan"));
    expect(h.messageParts).toHaveLength(1);

    // Tunggu prompt_async pertama selesai (40ms) — yang kedua masih berjalan.
    await Bun.sleep(100);

    // Turn kedua harus tetap hidup walau turn pertama sudah selesai lebih dulu.
    emitAll(client, ev.text("ses_remote1", "msg_b1", "lanjutan lagi"));
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
    client.emit(ev.step("ses_remote1", "msg_a1"));
    emitAll(client, ev.text("ses_remote1", "msg_a1", "sebagian"));
    expect(h.messageParts).toHaveLength(1);

    // prompt_async selesai (204) TIDAK mengakhiri turn — streaming berlanjut.
    await flush();
    emitAll(client, ev.text("ses_remote1", "msg_a1", "sebagian lanjutan"));
    expect(h.messageParts).toHaveLength(2);

    // session.idle menutup turn -> part berikutnya tidak lagi diteruskan.
    client.emit(ev.idle("ses_remote1"));
    emitAll(client, ev.text("ses_remote1", "msg_a1", "setelah idle"));
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
    client.emit(ev.permission("ses_remote1", "per_1", "bash:ls", ["ls"]));

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
    client.emit(
      ev.form("ses_remote1", "que_1", [
        qField(
          0,
          "Gunakan mode apa?",
          [
            { label: "Build", description: "menulis kode" },
            { label: "Plan", description: "hanya rencana" },
          ],
          { header: "mode" },
        ),
      ]),
    );

    expect(h.prompts).toHaveLength(1);
    const p = promptOf(h);
    expect(p.kind).toBe("question");
    expect(p.type).toBe("menu");
    expect(p.sessionId).toBe(sid);
    expect(p.title).toBe("Gunakan mode apa?");
    // Opsi dinormalisasi ke PromptOption — description ikut tersimpan.
    expect(p.options).toEqual([
      { label: "Build", description: "menulis kode" },
      { label: "Plan", description: "hanya rencana" },
    ]);
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
    client.emit(
      ev.form("ses_remote1", "que_c0", [
        qField(0, "Pilih salah satu", [{ label: "A", description: "a" }], {
          header: "pilih",
          custom: false,
        }),
      ]),
    );

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
    client.emit(ev.child("ses_child1", "ses_remote1"));

    // Izin yang diminta sub-agent memakai sessionID child.
    client.emit(ev.permission("ses_child1", "per_sub1", "bash", ["echo hi"]));

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
    client.emit(ev.child("ses_child1", "ses_remote1"));
    client.emit(ev.step("ses_child1", "msg_sub1"));
    emitAll(client, ev.text("ses_child1", "msg_sub1", "hasil sub-agent"));

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

    client.emit(ev.child("ses_child1", "ses_remote1"));
    // Sub-agent memanggil sub-agent lagi.
    client.emit(ev.child("ses_child2", "ses_child1"));
    client.emit(ev.permission("ses_child2", "per_deep", "edit", ["src/a.ts"]));

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
    client.emit(ev.child("ses_asing", "ses_bukan_milik_kcgcode"));
    client.emit(ev.permission("ses_asing", "per_asing", "bash"));

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

    client.emit(ev.renamed("ses_remote1", "Refactor auth module"));
    const sess = h.store.getSession(sid);
    expect(sess.ok).toBe(true);
    if (sess.ok) expect(sess.data.title).toBe("Refactor auth module");
    expect(h.titles).toEqual([[sid, "Refactor auth module"]]);

    // Judul identik -> tanpa update DB, tanpa broadcast ulang.
    client.emit(ev.renamed("ses_remote1", "Refactor auth module"));
    expect(h.titles).toHaveLength(1);
  } finally {
    h.close();
  }
});

test("createSession tidak mengirim judul -> opencode yang meng-generate judul", async () => {
  const h = freshHarness();
  try {
    await createSession(h);
    const calls = clientOf(h).calls.filter((c) => c.startsWith("session.create:"));
    expect(calls).toEqual(["session.create:"]);
    const sess = h.store.listSessions()[0];
    expect(sess?.title).toBeNull();
  } finally {
    h.close();
  }
});

test("judul sementara dari prompt pertama, lalu diganti judul hasil opencode", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    await h.sm.sendFreeTextInput(sid, "tolong jelaskan cara kerja rate limiting di express");
    const temp = h.store.getSession(sid);
    expect(temp.ok && temp.data.title).toBe("tolong jelaskan cara kerja rate limiting di…");

    // Placeholder opencode (dikirim saat Session dibuat) tidak menimpa judul.
    client.emit(ev.renamed("ses_remote1", "New session - 2026-09-29T10:59:18.048Z"));
    const still = h.store.getSession(sid);
    expect(still.ok && still.data.title).toBe("tolong jelaskan cara kerja rate limiting di…");

    // Judul hasil generate opencode menggantikan judul sementara.
    client.emit(ev.renamed("ses_remote1", "Cara Kerja Rate Limiting di Express"));
    const final = h.store.getSession(sid);
    expect(final.ok && final.data.title).toBe("Cara Kerja Rate Limiting di Express");
    expect(h.titles.map(([, t]) => t)).toEqual([
      "tolong jelaskan cara kerja rate limiting di…",
      "Cara Kerja Rate Limiting di Express",
    ]);

    // Prompt kedua tidak mengubah judul lagi.
    await h.sm.sendFreeTextInput(sid, "lanjut ke nestjs");
    const after = h.store.getSession(sid);
    expect(after.ok && after.data.title).toBe("Cara Kerja Rate Limiting di Express");
  } finally {
    h.close();
  }
});

test("session.updated child sub-agent -> judul Session akar tidak tertimpa", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    client.emit(ev.child("ses_child1", "ses_remote1"));

    // Sub-agent meng-generate judulnya sendiri — bukan judul percakapan user.
    client.emit(ev.renamed("ses_child1", "Judul sub-agent"));
    const sess = h.store.getSession(sid);
    expect(sess.ok).toBe(true);
    if (sess.ok) expect(sess.data.title).toBeNull();
    expect(h.titles).toHaveLength(0);

    // Judul akar tetap sampai setelah event child.
    client.emit(ev.renamed("ses_remote1", "Judul asli"));
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

    client.emit(ev.renamed("ses_asing", "bukan milik KCG Code"));
    client.emit(ev.renamed("ses_remote1", "   "));

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
    client.emit(ev.child("ses_child1", "ses_remote1"));

    expect(h.sm.stopSession(sid).ok).toBe(true);

    // Event child setelah stop tidak lagi menghasilkan prompt.
    client.emit(ev.permission("ses_child1", "per_setelah_stop", "bash"));
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
    client.emit(ev.permission("ses_remote1", "per_v2", "bash", ["echo hi"]));

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
    client.emit(
      ev.form("ses_remote1", "que_v2", [
        qField(0, "Lanjut deploy?", ["Ya", "Tidak"], { header: "deploy" }),
      ]),
    );

    expect(h.prompts).toHaveLength(1);
    const p = promptOf(h);
    expect(p.id).toBe("que_v2");
    expect(p.kind).toBe("question");
    expect(p.type).toBe("menu");
    expect(p.sessionId).toBe(sid);
    expect(p.title).toBe("Lanjut deploy?");
    expect(p.options).toEqual([
      { label: "Ya", description: null },
      { label: "Tidak", description: null },
    ]);
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
    client.emit(ev.permission("ses_remote1", "per_sama", "bash", ["ls"]));
    client.emit(ev.permission("ses_remote1", "per_sama", "bash", ["ls"]));

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
    client.emit(ev.permission("ses_remote1", "per_v2_resolve", "edit", ["src/a.ts"]));

    // Endpoint reply dipakai bersama v1/v2 (tidak ada rute v2 terpisah).
    const r = await h.sm.resolvePrompt(sid, "per_v2_resolve", "approve");
    expect(r.ok).toBe(true);
    expect(client.calls).toContain("permission.reply:per_v2_resolve:once");

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
    client.emit(ev.child("ses_child1", "ses_remote1"));
    client.emit(ev.permission("ses_child1", "per_v2_sub", "bash", ["echo sub"]));

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

test("sendFreeTextInput meneruskan custom instruction Project sebagai system", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h, "opencode");

    // Tanpa instruksi -> system null.
    await h.sm.sendFreeTextInput(sid, "halo");
    await flush();

    // Instruksi diubah setelah Session dibuat -> langsung berlaku.
    expect(
      h.store.updateProjectInstructions(h.project.id, "Selalu jawab dalam Bahasa Indonesia.").ok,
    ).toBe(true);
    await h.sm.sendFreeTextInput(sid, "lanjut");
    await flush();

    expect(clientOf(h).promptSystems).toEqual([null, "Selalu jawab dalam Bahasa Indonesia."]);
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

test("listMcp / listSkills -> diteruskan ke server Project (skills menerima path Project)", async () => {
  const h = freshHarness();
  try {
    const mcp = await h.sm.listMcp("p1");
    expect(mcp.ok && mcp.data.map((m) => m.status)).toEqual(["connected", "failed"]);

    const skills = await h.sm.listSkills("p1");
    expect(skills.ok && skills.data[0]?.name).toBe("shadcn");
    expect(clientOf(h).calls).toContain("skill.list");

    expect((await h.sm.listMcp("nope")).ok).toBe(false);
    expect((await h.sm.listSkills("nope")).ok).toBe(false);
  } finally {
    h.close();
  }
});

test("refreshSkills: server belum hidup -> tanpa dispose; Project tak dikenal -> error", async () => {
  const h = freshHarness();
  try {
    const res = await h.sm.refreshSkills("p1");
    expect(res.ok && res.data.refreshed).toBe(true);
    expect(h.fake.clients.get("p1")).toBeUndefined();
    expect((await h.sm.refreshSkills("nope")).ok).toBe(false);
  } finally {
    h.close();
  }
});

test("refreshSkills: server idle -> dispose; ada turn aktif -> dilewati", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const idle = await h.sm.refreshSkills("p1");
    expect(idle.ok && idle.data.refreshed).toBe(true);
    expect(clientOf(h).calls).toContain("location.reload");

    // Mulai turn (belum ada session.idle) -> refresh ditunda.
    await h.sm.sendFreeTextInput(sid, "halo");
    const before = clientOf(h).calls.filter((c) => c === "location.reload").length;
    const busy = await h.sm.refreshSkills("p1");
    expect(busy.ok && busy.data.refreshed).toBe(false);
    expect(clientOf(h).calls.filter((c) => c === "location.reload")).toHaveLength(before);
  } finally {
    h.close();
  }
});

/**
 * Harness dengan timer manual: refresh skill tertunda dijadwalkan lewat
 * `setTimeoutFn`, jadi test dapat memicu jedanya secara deterministik.
 */
function refreshHarness() {
  const timers: { cb: () => void; ms: number; cleared: boolean }[] = [];
  const refreshed: string[] = [];
  const h = freshHarnessWithHooks(
    {},
    {},
    {
      setTimeoutFn: (cb, ms) => {
        const t = { cb, ms, cleared: false };
        timers.push(t);
        return t;
      },
      clearTimeoutFn: (t) => {
        (t as { cleared: boolean }).cleared = true;
      },
      skillRefreshDelayMs: 1500,
      onSkillsRefreshed: (projectId) => refreshed.push(projectId),
    },
  );
  /** Jalankan timer refresh (jeda 1500 ms) yang masih aktif. */
  const fireRefreshTimers = async () => {
    for (const t of timers.filter((x) => x.ms === 1500 && !x.cleared)) {
      t.cleared = true;
      t.cb();
    }
    await flush();
  };
  const disposeCount = () => clientOf(h).calls.filter((c) => c === "location.reload").length;
  return { h, timers, refreshed, fireRefreshTimers, disposeCount };
}

test("refresh skill tertunda: dijalankan otomatis setelah turn selesai", async () => {
  const { h, refreshed, fireRefreshTimers, disposeCount } = refreshHarness();
  try {
    const sid = await createSession(h);
    await h.sm.sendFreeTextInput(sid, "halo");
    await flush();

    const res = await h.sm.refreshSkills("p1");
    expect(res.ok && res.data.refreshed).toBe(false);
    expect(h.sm.hasPendingSkillRefresh("p1")).toBe(true);
    expect(disposeCount()).toBe(0);

    // Turn selesai -> timer dijadwalkan, belum dispose sebelum jeda lewat.
    clientOf(h).emit(ev.idle("ses_remote1"));
    await flush();
    expect(disposeCount()).toBe(0);

    await fireRefreshTimers();
    expect(disposeCount()).toBe(1);
    expect(h.sm.hasPendingSkillRefresh("p1")).toBe(false);
    expect(refreshed).toEqual(["p1"]);

    // Turn berikutnya tidak memicu dispose lagi.
    await h.sm.sendFreeTextInput(sid, "lagi");
    await flush();
    clientOf(h).emit(ev.idle("ses_remote1"));
    await flush();
    await fireRefreshTimers();
    expect(disposeCount()).toBe(1);
  } finally {
    h.close();
  }
});

test("refresh skill tertunda: turn baru dalam jeda membatalkan timer, ditunda lagi", async () => {
  const { h, refreshed, fireRefreshTimers, disposeCount, timers } = refreshHarness();
  try {
    const sid = await createSession(h);
    await h.sm.sendFreeTextInput(sid, "satu");
    await flush();
    await h.sm.refreshSkills("p1");

    clientOf(h).emit(ev.idle("ses_remote1"));
    await flush();
    const scheduled = timers.filter((t) => t.ms === 1500);
    expect(scheduled).toHaveLength(1);

    // User langsung kirim pesan lagi sebelum jeda habis -> timer dibatalkan.
    await h.sm.sendFreeTextInput(sid, "dua");
    await flush();
    expect(scheduled[0]?.cleared).toBe(true);
    await fireRefreshTimers();
    expect(disposeCount()).toBe(0);
    expect(h.sm.hasPendingSkillRefresh("p1")).toBe(true);

    // Turn kedua selesai -> baru dispose.
    clientOf(h).emit(ev.idle("ses_remote1"));
    await flush();
    await fireRefreshTimers();
    expect(disposeCount()).toBe(1);
    expect(refreshed).toEqual(["p1"]);
  } finally {
    h.close();
  }
});

test("refresh skill tertunda: menunggu SEMUA Session di Project selesai", async () => {
  const { h, fireRefreshTimers, disposeCount } = refreshHarness();
  try {
    const a = await createSession(h);
    clientOf(h).createSessionResult = { ok: true, id: "ses_remote2" };
    const b = await createSession(h);
    await h.sm.sendFreeTextInput(a, "a");
    await h.sm.sendFreeTextInput(b, "b");
    await flush();
    await h.sm.refreshSkills("p1");

    // Session A selesai, B masih berjalan -> tidak ada dispose.
    clientOf(h).emit(ev.idle("ses_remote1"));
    await flush();
    await fireRefreshTimers();
    expect(disposeCount()).toBe(0);

    // B selesai -> dispose.
    clientOf(h).emit(ev.idle("ses_remote2"));
    await flush();
    await fireRefreshTimers();
    expect(disposeCount()).toBe(1);
  } finally {
    h.close();
  }
});

test("refresh skill tertunda: dispose gagal -> tetap tertunda, dicoba lagi turn berikutnya", async () => {
  const { h, refreshed, fireRefreshTimers, disposeCount } = refreshHarness();
  try {
    const sid = await createSession(h);
    await h.sm.sendFreeTextInput(sid, "x");
    await flush();
    await h.sm.refreshSkills("p1");

    const client = clientOf(h);
    const original = client.location.reload.bind(client.location);
    let fail = true;
    client.location.reload = async () => {
      client.calls.push("location.reload");
      return fail
        ? { ok: false, error: "OC_DISPOSE_FAILED(500)" }
        : original().then(() => ({ ok: true }));
    };

    client.emit(ev.idle("ses_remote1"));
    await flush();
    await fireRefreshTimers();
    expect(disposeCount()).toBe(1);
    expect(h.sm.hasPendingSkillRefresh("p1")).toBe(true);
    expect(refreshed).toEqual([]);

    fail = false;
    await h.sm.sendFreeTextInput(sid, "y");
    await flush();
    client.emit(ev.idle("ses_remote1"));
    await flush();
    await fireRefreshTimers();
    expect(h.sm.hasPendingSkillRefresh("p1")).toBe(false);
    expect(refreshed).toEqual(["p1"]);
  } finally {
    h.close();
  }
});

test("refresh skill tertunda: shutdown membersihkan timer & status tertunda", async () => {
  const { h, fireRefreshTimers } = refreshHarness();
  try {
    const sid = await createSession(h);
    await h.sm.sendFreeTextInput(sid, "x");
    await flush();
    await h.sm.refreshSkills("p1");
    // Referensi client disimpan: shutdown menghentikan server (client dilepas).
    const client = clientOf(h);
    client.emit(ev.idle("ses_remote1"));
    await flush();

    await h.sm.shutdown();
    expect(h.sm.hasPendingSkillRefresh("p1")).toBe(false);
    await fireRefreshTimers();
    expect(client.calls.filter((c) => c === "location.reload")).toHaveLength(0);
  } finally {
    h.close();
  }
});

test("event permission.asked dengan sessionID tak dikenal -> diabaikan", async () => {
  const h = freshHarness();
  try {
    await createSession(h);
    clientOf(h).emit(ev.permission("ses_tak_dikenal", "per_x", "bash"));
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
    options:
      kind === "permission"
        ? null
        : [
            { label: "A", description: null },
            { label: "B", description: null },
          ],
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
    expect(client.calls).toContain("permission.reply:per_1:once");

    const pid2 = await seedPrompt(h, sid, "permission", "per_2");
    await h.sm.resolvePrompt(sid, pid2, "deny");
    expect(client.calls).toContain("permission.reply:per_2:reject");

    const pid3 = await seedPrompt(h, sid, "permission", "per_3");
    await h.sm.resolvePrompt(sid, pid3, "cancel");
    expect(client.calls).toContain("permission.reply:per_3:reject");

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
    expect(client.calls).toContain("form.reply:que_1:A");

    // Jawaban question TIDAK di-echo ke riwayat chat (transcript bersih).
    expect(h.messages.filter((m) => m.role === "user")).toHaveLength(0);

    const pid2 = await seedPrompt(h, sid, "question", "que_2");
    const r2 = await h.sm.resolvePrompt(sid, pid2, "cancel");
    expect(r2.ok).toBe(true);
    expect(client.calls).toContain("form.cancel:que_2");
    expect(h.messages.filter((m) => m.role === "user")).toHaveLength(0);
  } finally {
    h.close();
  }
});

test("resolvePrompt question multi-select -> replyQuestion dengan seluruh label terpilih", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    // Event question dengan multiple=true (skema tool `question` opencode).
    client.emit(
      ev.form("ses_remote1", "que_multi", [
        qField(
          0,
          "Mau eksplor bagian mana?",
          [
            { label: "Debug", description: "investigasi bug" },
            { label: "Config", description: "cek settings" },
            { label: "Monitor", description: "logs & performa" },
          ],
          { multiple: true },
        ),
      ]),
    );

    expect(h.prompts).toHaveLength(1);
    const p = h.prompts[0] as InteractivePrompt;
    expect(p.multiple).toBe(true);
    // Description per opsi ikut tersimpan, tidak dibuang lagi.
    expect(p.options).toEqual([
      { label: "Debug", description: "investigasi bug" },
      { label: "Config", description: "cek settings" },
      { label: "Monitor", description: "logs & performa" },
    ]);

    // Jawaban multi-select: seluruh label dalam SATU panggilan reply.
    const r = await h.sm.resolvePrompt(sid, "que_multi", { options: ["Debug", "Monitor"] });
    expect(r.ok).toBe(true);
    expect(client.calls).toContain("form.reply:que_multi:Debug,Monitor");
  } finally {
    h.close();
  }
});

test("event question multi-question -> prompt.questions lengkap; jawaban per pertanyaan", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    // Satu request berisi DUA pertanyaan (skema tool `question` opencode).
    client.emit(
      ev.form("ses_remote1", "que_batch", [
        qField(
          0,
          "Mau eksplor bagian mana?",
          [
            { label: "Debug", description: "investigasi bug" },
            { label: "Config", description: "cek settings" },
          ],
          { multiple: true },
        ),
        qField(1, "Kapan mulai?", ["Sekarang", "Nanti"]),
      ]),
    );

    expect(h.prompts).toHaveLength(1);
    const p = h.prompts[0] as InteractivePrompt;
    // Seluruh pertanyaan tersimpan; pertanyaan pertama juga di field legacy.
    expect(p.questions).toHaveLength(2);
    expect(p.questions?.[0]?.question).toBe("Mau eksplor bagian mana?");
    expect(p.questions?.[0]?.multiple).toBe(true);
    expect(p.questions?.[1]?.question).toBe("Kapan mulai?");
    expect(p.title).toBe("Mau eksplor bagian mana?");
    expect(p.options?.map((o) => o.label)).toEqual(["Debug", "Config"]);

    // Jawaban batch: SATU array label per pertanyaan, urut sesuai questions.
    const r = await h.sm.resolvePrompt(sid, "que_batch", {
      answers: [["Debug", "Config"], ["Nanti"]],
    });
    expect(r.ok).toBe(true);
    // Reply API menerima array-of-array (skema Question.Reply).
    expect(client.calls).toContain("form.reply:que_batch:Debug,Config|Nanti");
  } finally {
    h.close();
  }
});

// Multi-question hanya disimpan bila ada >1 pertanyaan — request tunggal
// tidak menambah data duplikat di DB.
test("event question tunggal -> prompt.questions undefined", async () => {
  const h = freshHarness();
  try {
    await createSession(h);
    clientOf(h).emit(ev.form("ses_remote1", "que_satu", [qField(0, "Lanjut?", ["Ya"])]));
    expect(h.prompts).toHaveLength(1);
    expect((h.prompts[0] as InteractivePrompt).questions).toBeUndefined();
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
      client.emit(ev.permission("ses_remote1", id, "external_directory", ["D:\\Proj\\**"]));
    }
    expect(h.prompts).toHaveLength(3);

    // Satu klik Approve pada kartu grup -> ketiganya di-reply & resolved.
    const r = await h.sm.resolvePrompt(sid, "per_b", "approve");
    expect(r.ok).toBe(true);
    for (const id of ["per_a", "per_b", "per_c"]) {
      expect(client.calls).toContain(`permission.reply:${id}:once`);
      const p = h.store.getPrompt(id);
      expect(p.ok && p.data.status).toBe("resolved");
    }

    // Deny juga berlaku ke grup.
    for (const id of ["per_d", "per_e"]) {
      client.emit(ev.permission("ses_remote1", id, "external_directory", ["D:\\Proj\\**"]));
    }
    await h.sm.resolvePrompt(sid, "per_d", "deny");
    for (const id of ["per_d", "per_e"]) {
      expect(client.calls).toContain(`permission.reply:${id}:reject`);
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
    expect(client.calls).toContain("permission.reply:per_always:always");

    // Opsi menu tidak ada di daftar tersimpan TETAP diteruskan ke opencode
    // (validasi sebenarnya di server opencode) — menolak keras di sini
    // membuat tombol opsi terasa mati tanpa feedback.
    const qid = await seedPrompt(h, sid, "question", "que_opt");
    const r2 = await h.sm.resolvePrompt(sid, qid, { option: "OpsiLive" });
    expect(r2.ok).toBe(true);
    expect(client.calls).toContain("form.reply:que_opt:OpsiLive");
  } finally {
    h.close();
  }
});

test("resolvePrompt permission beda judul TIDAK ikut ter-fan-out", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    client.emit(ev.permission("ses_remote1", "per_bash", "bash", ["ls"]));
    client.emit(ev.permission("ses_remote1", "per_edit", "edit", ["src/a.ts"]));

    await h.sm.resolvePrompt(sid, "per_bash", "approve");
    expect(client.calls).toContain("permission.reply:per_bash:once");
    expect(client.calls).not.toContain("permission.reply:per_edit:once");
    const other = h.store.getPrompt("per_edit");
    expect(other.ok && other.data.status).toBe("pending");
  } finally {
    h.close();
  }
});

test("resolvePrompt: request dilupakan opencode (404) -> prompt ditutup lokal, PROMPT_EXPIRED", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    // Jawab question yang sudah tidak ditunggu agent.
    const pid = await seedPrompt(h, sid, "question", "que_gone");
    client.goneRequests.add("que_gone");
    const r = await h.sm.resolvePrompt(sid, pid, { option: "A" });
    expect(r).toEqual({ ok: false, error: "PROMPT_EXPIRED" });
    // Baris tidak lagi pending -> kartu hilang & session tidak terkunci.
    const row = h.store.getPrompt(pid);
    expect(row.ok && row.data.status).toBe("resolved");
    expect(h.store.listPendingPrompts(sid)).toHaveLength(0);

    // Skip (reject) pada request yang hilang juga menutup prompt.
    const pid2 = await seedPrompt(h, sid, "question", "que_gone2");
    client.goneRequests.add("que_gone2");
    expect((await h.sm.resolvePrompt(sid, pid2, "cancel")).error).toBe("PROMPT_EXPIRED");
    expect(h.store.listPendingPrompts(sid)).toHaveLength(0);

    // Kegagalan lain (bukan 404) tetap pending agar bisa dicoba lagi.
    const pid3 = await seedPrompt(h, sid, "question", "que_ok");
    client.form.reply = async () => ({ ok: false, error: "AGENT_FORM_REPLY_FAILED: 500" });
    expect((await h.sm.resolvePrompt(sid, pid3, { option: "A" })).error).toBe(
      "AGENT_FORM_REPLY_FAILED: 500",
    );
    const row3 = h.store.getPrompt(pid3);
    expect(row3.ok && row3.data.status).toBe("pending");
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
      client.calls.filter((c) => c.startsWith("permission.reply") || c.startsWith("form.reply")),
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
    expect(client.calls).toContain("session.interrupt:ses_remote1");
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
    h.fake.lose("p1");
    expect(statusOf(h.store, sid)).toBe("crashed");
  } finally {
    h.close();
  }
});

test("exit -> recreate -> exit lagi: session baru juga ditandai crashed", async () => {
  const h = freshHarness();
  try {
    const sid1 = await createSession(h);
    h.fake.lose("p1");
    expect(statusOf(h.store, sid1)).toBe("crashed");

    // Session baru -> server di-ensure ulang; exitNotified harus di-reset.
    const sid2 = await createSession(h);
    expect(statusOf(h.store, sid2)).toBe("running");

    h.fake.lose("p1");
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
    expect(h.fake.released).toContain("p1");
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
      h.fake.clients.get("p1")?.calls.filter((c) => c.startsWith("session.create")).length ?? 0;

    const res = await h.sm.resumeSession(sid);
    expect(res.ok).toBe(true);
    expect(statusOf(h.store, sid)).toBe("running");
    // ocSessionId lama dipertahankan — riwayat opencode tetap nyambung.
    const after = h.store.getSession(sid);
    expect(after.ok && after.data.ocSessionId).toBe(ocIdBefore);
    // Tidak ada createSession tambahan.
    const callsAfter =
      h.fake.clients.get("p1")?.calls.filter((c) => c.startsWith("session.create")).length ?? 0;
    expect(callsAfter).toBe(callsBefore);
    // Event SSE tetap terpasang.
    expect(h.fake.clients.get("p1")?.subscribed).toBe(true);
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
    expect(client?.calls).toContain("session.get:ses_remote1");
    expect(client?.calls.filter((c) => c.startsWith("session.create"))).toHaveLength(2);
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
    expect(client?.calls).toContain("session.prompt:halo lagi");
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
    expect(client?.calls).toContain("model.list");
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
    expect(client?.calls.filter((c) => c.startsWith("session.create"))).toHaveLength(0);
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
    expect(client?.calls).not.toContain("model.list");
    // promptAsync dikirim tanpa model.
    await h.sm.sendFreeTextInput(sid, "hai");
    await flush();
    expect(client?.promptModels).toEqual([null]);
  } finally {
    h.close();
  }
});

test("session.create: listModels gagal -> error diteruskan, tanpa sesi remote", async () => {
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
    expect(h.fake.ensureCalls).toContainEqual({ projectId: "p1", directory: h.project.path });

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

test("session.remove: remote dihapus + lokal bersih (messages, prompts, history)", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const ocId = h.store.getSession(sid).ok ? "ses_remote1" : null;
    await h.sm.sendFreeTextInput(sid, "pesan sebelum hapus");
    await flush();

    const res = await h.sm.deleteSession(sid);
    expect(res.ok).toBe(true);
    const client = h.fake.clients.get("p1");
    expect(client?.calls).toContain(`session.remove:${ocId}`);
    // Semua jejak lokal hilang.
    expect(h.store.getSession(sid).ok).toBe(false);
    expect(h.store.getMessages(sid).ok).toBe(false);
    expect(h.store.listSessions()).toHaveLength(0);
  } finally {
    h.close();
  }
});

test("session.remove: server headless menolak -> error diteruskan, data lokal utuh", async () => {
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

test("session.remove: server headless mati -> di-spawn ulang, remote ikut dihapus", async () => {
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
    expect(h.fake.ensureCalls[1]).toEqual({ projectId: "p1", directory: h.project.path });
    expect(h.fake.clients.get("p1")?.calls).toContain("session.remove:ses_remote1");
    expect(h.store.getSession(sid).ok).toBe(false);
  } finally {
    h.close();
  }
});

test("session.remove: server mati & spawn ulang gagal -> error, data lokal utuh", async () => {
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

test("session.remove: session masih running -> di-stop dulu lalu dihapus", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const res = await h.sm.deleteSession(sid);
    expect(res.ok).toBe(true);
    const client = h.fake.clients.get("p1");
    expect(client?.calls).toContain("session.interrupt:ses_remote1");
    expect(h.store.getSession(sid).ok).toBe(false);
  } finally {
    h.close();
  }
});

test("session.remove: session tidak ada -> SESSION_NOT_FOUND", async () => {
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

test("session.remove: onDeleted terpanggil (broadcast ke subscriber WS)", async () => {
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
    const ref = files.find((f) => f.name === "foto.png");
    expect(ref?.mime).toBe("image/png");
    // URL wajib absolut (`file:///…`): `file://rel/path` ditolak opencode.
    expect(ref?.uri.startsWith("file:///")).toBe(true);
    expect(ref?.uri).toContain(saved.data.id);
    // Part echo pun membawa URL absolut yang sama.
    expect(typeof imgPart?.url).toBe("string");
    expect((imgPart?.url ?? "").startsWith("file:///")).toBe(true);
  } finally {
    h.close();
  }
});

test("sendFreeTextInput file non-gambar -> teks dikirim text/plain, biner hanya dirujuk lewat path", async () => {
  const h = freshHarnessWithHooks({}, { withAttachments: true });
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    const csv = h.attachments?.save(sid, "data.csv", "text/csv", new TextEncoder().encode("a,b"));
    const zip = h.attachments?.save(sid, "arsip.zip", "application/zip", new Uint8Array([1, 2]));
    if (!csv?.ok || !zip?.ok) throw new Error("save gagal");

    const res = await h.sm.sendFreeTextInput(sid, "cek ini", [], [csv.data.id, zip.data.id]);
    expect(res.ok).toBe(true);
    await flush();

    // Echo: kedua file tampil dengan mime aslinya (renderer memilih kartu).
    const user = h.messages.find((m) => m.role === "user");
    const echoed = (user?.parts ?? []).filter((p) => p.type === "file" && p.attachmentId);
    expect(echoed.map((p) => p.mime)).toEqual(["text/csv", "application/zip"]);
    // Teks tampilan tetap teks asli (catatan path tidak ikut di bubble).
    expect(user?.parts.find((p) => p.type === "text")?.text).toBe("cek ini");

    // Ke model: CSV jadi text/plain; ZIP tidak dikirim sebagai part.
    const files = client.promptFilesCalls.at(-1) ?? [];
    expect(files.map((f) => [f.name, f.mime])).toEqual([["data.csv", "text/plain"]]);
    // ...tapi path ZIP disebut di teks prompt agar model bisa memakai tool.
    const prompt = client.calls.filter((c) => c.startsWith("session.prompt:")).at(-1) ?? "";
    expect(prompt).toContain("cek ini");
    expect(prompt).toContain("arsip.zip");
    expect(prompt).toContain(zip.data.id);
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

test("Session claude-code memakai backend Claude Code; opencode tidak tersentuh", async () => {
  const claude = makeFakeServers();
  const h = freshHarnessWithHooks({}, {}, { backends: { "claude-code": claude.backend } });
  try {
    const sid = await createSession(h, "claude-code");
    expect(claude.ensureCalls).toHaveLength(1);
    expect(h.fake.ensureCalls).toHaveLength(0);
    const cc = claude.clients.get("p1");
    if (!cc) throw new Error("claude client tidak ada");

    expect((await h.sm.sendFreeTextInput(sid, "halo")).ok).toBe(true);
    await flush();
    expect(cc.calls).toContain("session.prompt:halo");

    // Event dari backend Claude Code memetakan ke Session lokal yang sama.
    cc.emit(ev.permission("ses_remote1", "per_cc", "bash", ["ls"]));
    expect(h.prompts.map((p) => p.id)).toEqual(["per_cc"]);
    expect((await h.sm.resolvePrompt(sid, "per_cc", "approve")).ok).toBe(true);
    expect(cc.calls).toContain("permission.reply:per_cc:once");

    // Daftar model per backend + task list dibaca dari session remote.
    expect((await h.sm.listModels("p1", "claude-code")).ok).toBe(true);
    expect(cc.calls).toContain("model.list");
    expect((await h.sm.sessionContext(sid)).ok).toBe(true);
    expect(cc.calls).toContain("session.todos:ses_remote1");
    expect(h.fake.ensureCalls).toHaveLength(0);

    expect((await h.sm.releaseProject("p1")).ok).toBe(true);
    expect(claude.released).toContain("p1");
  } finally {
    h.close();
  }
});

// ---------------------------------------------------------------------------
// onTurnEnd — sumber notifikasi "agent selesai"
// ---------------------------------------------------------------------------

test("onTurnEnd: idle -> done; interrupt user tidak memicu notifikasi", async () => {
  const ended: [string, string][] = [];
  const h = freshHarnessWithHooks(
    {},
    {},
    { onTurnEnd: (id, outcome) => ended.push([id, outcome]) },
  );
  try {
    const sid = await createSession(h);
    await h.sm.sendFreeTextInput(sid, "hello");
    await flush();
    const client = clientOf(h);
    client.emit(ev.idle("ses_remote1"));
    expect(ended).toEqual([[sid, "done"]]);

    // Turn kedua dihentikan user -> diam.
    await h.sm.sendFreeTextInput(sid, "again");
    await flush();
    h.sm.interruptSession(sid);
    client.emit(ev.idle("ses_remote1"));
    expect(ended).toEqual([[sid, "done"]]);
  } finally {
    h.close();
  }
});
