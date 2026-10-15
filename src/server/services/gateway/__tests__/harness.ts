/**
 * Harness test WebSocket_Gateway (bukan file test): `Subscriber` palsu yang
 * mencatat pesan terkirim, `SessionManager` palsu, dan gateway nyata di
 * atas store `bun:sqlite` asli.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openSessionStore, type SessionStore } from "../../../../db";
import type { InteractivePrompt, PromptResponse, SessionMessage } from "../../../../types";
import type { ServerMessage } from "../../../../ws-protocol";
import type { SessionManager } from "../../session-manager";
import {
  createWebSocketGateway,
  type Subscriber,
  type WebSocketGateway,
} from "../../websocket-gateway";

// ---------------------------------------------------------------------------
// Mock Subscriber (ws.send)
// ---------------------------------------------------------------------------

export interface MockSub extends Subscriber {
  id: string;
  sent: ServerMessage[];
  closed: boolean;
  failOnSend: boolean;
}

export function makeSub(id: string, failOnSend = false): MockSub {
  const sent: ServerMessage[] = [];
  const sub: MockSub = {
    id,
    sent,
    closed: false,
    failOnSend,
    send(msg: ServerMessage) {
      if (sub.failOnSend) throw new Error(`mock send failure (${id})`);
      sent.push(msg);
    },
    close() {
      sub.closed = true;
    },
  };
  return sub;
}

export type HistoryMsg = Extract<ServerMessage, { type: "history" }>;

export function makeMessage(
  sessionId: string,
  id: string,
  role: "user" | "assistant",
): SessionMessage {
  return {
    id,
    sessionId,
    role,
    parts: [{ type: "text", text: `isi-${id}` }],
    createdAt: 0,
  };
}

export function makePrompt(
  sessionId: string,
  id: string,
  kind: "permission" | "question",
): InteractivePrompt {
  return {
    id,
    sessionId,
    kind,
    type: kind === "permission" ? "confirmation" : "menu",
    title: kind === "permission" ? "bash:ls" : "Pilih",
    options:
      kind === "permission"
        ? null
        : [
            { label: "A", description: null },
            { label: "B", description: null },
          ],
    status: "pending",
    createdAt: 0,
    resolvedAt: null,
  };
}

// ---------------------------------------------------------------------------
// Mock SessionManager
// ---------------------------------------------------------------------------

export interface FakeSessionManager extends SessionManager {
  inputs: [string, string][];
  promptReplies: [string, string, PromptResponse][];
  stops: string[];
  interrupts: string[];
  inputResult: { ok: boolean; error?: string };
  resolveResult: { ok: boolean; error?: string };
  stopResult: { ok: boolean; error?: string };
  interruptResult: { ok: boolean; error?: string };
}

export function makeFakeSessionManager(): FakeSessionManager {
  const sm: FakeSessionManager = {
    inputs: [],
    promptReplies: [],
    stops: [],
    interrupts: [],
    inputResult: { ok: true },
    resolveResult: { ok: true },
    stopResult: { ok: true },
    interruptResult: { ok: true },
    async createSession() {
      return { ok: false, error: "not-used" };
    },
    listSessions: () => [],
    getSession: () => ({ ok: false, error: "SESSION_NOT_FOUND" }),
    stopSession(sessionId) {
      sm.stops.push(sessionId);
      return sm.stopResult;
    },
    interruptSession(sessionId) {
      sm.interrupts.push(sessionId);
      return sm.interruptResult;
    },
    async resumeSession() {
      return { ok: false, error: "not-used" };
    },
    async deleteSession() {
      return { ok: false, error: "not-used" };
    },
    async releaseProject() {
      return { ok: false, error: "not-used" };
    },
    async listExternalSessions() {
      return { ok: false, error: "not-used" };
    },
    async importExternalSession() {
      return { ok: false, error: "not-used" };
    },
    async findFiles() {
      return { ok: false, error: "not-used" };
    },
    async sessionContext() {
      return { ok: false, error: "not-used" };
    },
    async listModels() {
      return { ok: false, error: "not-used" };
    },
    async listAgents() {
      return { ok: false, error: "not-used" };
    },
    async listMcp() {
      return { ok: false, error: "not-used" };
    },
    async setMcpEnabled() {
      return { ok: false, error: "not-used" };
    },
    async reconnectMcp() {
      return { ok: false, error: "not-used" };
    },
    async listSkills() {
      return { ok: false, error: "not-used" };
    },
    async listCommands() {
      return { ok: false, error: "not-used" };
    },
    async refreshSkills() {
      return { ok: false, error: "not-used" };
    },
    hasPendingSkillRefresh() {
      return false;
    },
    setSessionModel() {
      return { ok: false, error: "not-used" };
    },
    setSessionEffort() {
      return { ok: false, error: "not-used" };
    },
    setSessionAgent() {
      return { ok: false, error: "not-used" };
    },
    async setSessionPermissionMode() {
      return { ok: false, error: "not-used" };
    },
    async listCapabilities() {
      return { ok: true, data: { permissionModes: [] } };
    },
    async sendFreeTextInput(sessionId, text) {
      sm.inputs.push([sessionId, text]);
      return sm.inputResult;
    },
    async resolvePrompt(sessionId, promptId, response) {
      sm.promptReplies.push([sessionId, promptId, response]);
      return sm.resolveResult;
    },
    reconcileOnStartup: () => {},
    async shutdown() {},
  };
  return sm;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

export interface Harness {
  store: SessionStore;
  sm: FakeSessionManager;
  gw: WebSocketGateway;
  /** `notify_ack` yang diteruskan gateway: [id, endpoint]. */
  acks: [string, string][];
  close(): void;
}

export function freshHarness(): Harness {
  const store = openSessionStore(":memory:");
  const root = mkdtempSync(path.join(tmpdir(), "kcg-wsg2-"));
  const cwd = path.join(root, "proj");
  mkdirSync(cwd, { recursive: true });
  store.insertProject({ id: "p1", name: "proj", path: cwd, createdAt: 1 });
  store.insertSession({
    id: "s1",
    projectId: "p1",
    agentType: "opencode",
    cwd,
    status: "running",
    ocSessionId: "ses_1",
    model: null,
    agent: null,
    title: null,
    createdAt: 0,
    updatedAt: 0,
  });

  const sm = makeFakeSessionManager();
  const acks: [string, string][] = [];
  const gw = createWebSocketGateway({
    store,
    sessionManager: sm,
    onNotifyAck: (id, endpoint) => acks.push([id, endpoint]),
  });

  return {
    store,
    sm,
    gw,
    acks,
    close() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
