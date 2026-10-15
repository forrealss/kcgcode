/**
 * Harness test Session_Manager (bukan file test): pembangun event agent
 * (bentuk opencode v2), `createSessionManager` dengan seluruh hook dicatat,
 * dan helper kecil yang dipakai bersama file test di folder ini.
 *
 * Mocking boundary: `AgentBackend` + `AgentClient` di-mock seluruhnya
 * (`fake-agent.ts`); `bun:sqlite` asli.
 */
import { expect } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openSessionStore, type SessionStore } from "../../../../db";
import type {
  AgentType,
  InteractivePrompt,
  MessagePart,
  Project,
  SessionMessage,
  SessionStatus,
} from "../../../../types";
import {
  type FakeAgentClient,
  type FakeBackend,
  makeFakeBackend,
  makeFakeClient,
} from "../../../__tests__/fake-agent";
import type { AgentEvent, AgentFormField } from "../../../agents/types";
import { type AttachmentManager, createAttachmentManager } from "../../attachments";
import { createSessionManager, type SessionManager } from "../../session-manager";

export type FakeClient = FakeAgentClient;

export type FakeServers = FakeBackend;

export function makeFakeServers(): FakeServers {
  return makeFakeBackend("opencode");
}

// ---------------------------------------------------------------------------
// Pembangun event agent (bentuk opencode v2)
// ---------------------------------------------------------------------------

/** Event agent ringkas untuk test. */
export const ev = {
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
export function qField(
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
export function emitAll(client: FakeClient, events: AgentEvent | AgentEvent[]): void {
  for (const e of Array.isArray(events) ? events : [events]) client.emit(e);
}

/** Part teks hasil proyeksi (`now` harness = 1000). */
export function textPart(msg: string, text: string, ordinal = 0, type = "text"): MessagePart {
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

export interface Harness {
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

export function freshHarness(): Harness {
  return freshHarnessWithHooks({});
}

export function freshHarnessWithHooks(
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
export async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

export async function createSession(
  h: Harness,
  agentType: AgentType = "opencode",
): Promise<string> {
  const res = await h.sm.createSession({ agentType, projectId: h.project.id });
  expect(res.ok).toBe(true);
  if (!res.ok) throw new Error(`harness createSession gagal: ${res.error}`);
  return res.session.id;
}

export function statusOf(store: SessionStore, sid: string): SessionStatus | undefined {
  const r = store.getSession(sid);
  return r.ok ? r.data.status : undefined;
}

/** Ambil FakeClient project "p1"; melempar bila belum ada (harusnya sudah dibuat). */
export function clientOf(h: Harness): FakeClient {
  const client = h.fake.clients.get("p1");
  if (!client) throw new Error("fake client p1 tidak ada");
  return client;
}

/** Prompt pertama yang tercatat; melempar bila kosong (harusnya sudah ada). */
export function promptOf(h: Harness): InteractivePrompt {
  const p = h.prompts[0];
  if (!p) throw new Error("belum ada prompt tercatat");
  return p;
}

// ---------------------------------------------------------------------------
// Harness permission mode (capability agent, mis. Claude Code)
// ---------------------------------------------------------------------------

export const MODES = [
  { id: "default", label: "Ask", description: "Ask" },
  { id: "plan", label: "Plan", description: "Plan" },
  { id: "bypassPermissions", label: "Bypass", description: "Bypass", dangerous: true },
];

/** Harness dengan backend Claude Code palsu yang punya permission mode. */
export function modeHarness() {
  const claude = makeFakeBackend("claude-code", () =>
    makeFakeClient({ capabilities: { skillReload: false, permissionModes: MODES } }),
  );
  const changes: [string, string | null][] = [];
  const h = freshHarnessWithHooks(
    {},
    {},
    {
      backends: { "claude-code": claude.backend },
      onPermissionModeChange: (sid, mode) => changes.push([sid, mode]),
    },
  );
  const client = () => {
    const c = claude.clients.get("p1");
    if (!c) throw new Error("client claude belum ada");
    return c;
  };
  return { h, claude, client, changes };
}
