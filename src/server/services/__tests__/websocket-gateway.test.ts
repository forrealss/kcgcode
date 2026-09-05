/**
 * Unit test `websocket-gateway.ts` (versi headless).
 *
 * - attach: history berisi `messages` + `prompts` pending (4.1, 4.4);
 *   Session tak dikenal -> error + close (4.3).
 * - input / prompt_response: diteruskan ke Session_Manager (async); error
 *   domain -> pesan `error` ke Client pengirim.
 * - notify*: broadcast ke seluruh subscriber Session (5.1, 5.2); kegagalan
 *   `send` satu Client tidak menghentikan Client lain (5.3).
 *
 * `Subscriber` (ws.send) dan `SessionManager` di-mock; store `bun:sqlite`
 * asli sesuai batasan mocking `design.md`.
 */
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import fc from "fast-check";
import { openSessionStore, type SessionStore } from "../../../db";
import type { InteractivePrompt, PromptResponse, SessionMessage } from "../../../types";
import { ErrorCodes, type ServerMessage } from "../../../ws-protocol";
import type { SessionManager } from "../session-manager";
import {
  createWebSocketGateway,
  dispatchClientMessage,
  type Subscriber,
  type WebSocketGateway,
} from "../websocket-gateway";

// ---------------------------------------------------------------------------
// Mock Subscriber (ws.send)
// ---------------------------------------------------------------------------

interface MockSub extends Subscriber {
  id: string;
  sent: ServerMessage[];
  closed: boolean;
  failOnSend: boolean;
}

function makeSub(id: string, failOnSend = false): MockSub {
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

type HistoryMsg = Extract<ServerMessage, { type: "history" }>;

function makeMessage(sessionId: string, id: string, role: "user" | "assistant"): SessionMessage {
  return {
    id,
    sessionId,
    role,
    parts: [{ type: "text", text: `isi-${id}` }],
    createdAt: 0,
  };
}

function makePrompt(
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
    options: kind === "permission" ? null : ["A", "B"],
    status: "pending",
    createdAt: 0,
    resolvedAt: null,
  };
}

// ---------------------------------------------------------------------------
// Mock SessionManager
// ---------------------------------------------------------------------------

interface FakeSessionManager extends SessionManager {
  inputs: [string, string][];
  promptReplies: [string, string, PromptResponse][];
  stops: string[];
  interrupts: string[];
  inputResult: { ok: boolean; error?: string };
  resolveResult: { ok: boolean; error?: string };
  stopResult: { ok: boolean; error?: string };
  interruptResult: { ok: boolean; error?: string };
}
function makeFakeSessionManager(): FakeSessionManager {
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
    async findFiles() {
      return { ok: false, error: "not-used" };
    },
    async listModels() {
      return { ok: false, error: "not-used" };
    },
    async listAgents() {
      return { ok: false, error: "not-used" };
    },
    setSessionModel() {
      return { ok: false, error: "not-used" };
    },
    setSessionAgent() {
      return { ok: false, error: "not-used" };
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

interface Harness {
  store: SessionStore;
  sm: FakeSessionManager;
  gw: WebSocketGateway;
  close(): void;
}

function freshHarness(): Harness {
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
    createdAt: 0,
    updatedAt: 0,
  });

  const sm = makeFakeSessionManager();
  const gw = createWebSocketGateway({ store, sessionManager: sm });

  return {
    store,
    sm,
    gw,
    close() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

// ---------------------------------------------------------------------------
// Attach
// ---------------------------------------------------------------------------

test("attach: history berisi messages terurut + prompts pending (4.1, 4.4)", () => {
  const h = freshHarness();
  try {
    h.store.insertMessage(makeMessage("s1", "m1", "user"));
    h.store.insertMessage(makeMessage("s1", "m2", "assistant"));
    h.store.insertPrompt(makePrompt("s1", "pr1", "permission"));
    h.store.insertPrompt(makePrompt("s1", "pr2", "question"));
    h.store.updatePromptStatus("pr2", "resolved", 5);

    const sub = makeSub("c1");
    h.gw.attach(sub, "s1");

    const hist = sub.sent.find((m): m is HistoryMsg => m.type === "history");
    expect(hist).toBeDefined();
    if (hist) {
      expect(hist.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
      expect(hist.prompts.map((p) => p.id)).toEqual(["pr1"]); // hanya pending
    }
    expect(h.gw.subscriberCount("s1")).toBe(1);
  } finally {
    h.close();
  }
});

test("attach session tak dikenal -> error SESSION_NOT_FOUND + close, tanpa history (4.3)", () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 20 }), (unknownId) => {
      const h = freshHarness();
      try {
        const sub = makeSub("c1");
        h.gw.attach(sub, unknownId);
        const err = sub.sent.find((m): m is Extract<ServerMessage, { type: "error" }> => {
          return m.type === "error";
        });
        expect(err).toBeDefined();
        if (err) expect(err.code).toBe(ErrorCodes.SESSION_NOT_FOUND);
        expect(sub.closed).toBe(true);
        expect(sub.sent.some((m) => m.type === "history")).toBe(false);
        expect(h.gw.subscriberCount(unknownId)).toBe(0);
      } finally {
        h.close();
      }
    }),
    { numRuns: 100 },
  );
});

// ---------------------------------------------------------------------------
// Wire pesan Client -> Session_Manager
// ---------------------------------------------------------------------------

test("input diteruskan; input invalid -> error INVALID_TEXT", async () => {
  const h = freshHarness();
  try {
    const sub = makeSub("c1");
    h.gw.attach(sub, "s1");

    h.gw.input(sub, "s1", "hello");
    await Bun.sleep(0);
    expect(h.sm.inputs).toEqual([["s1", "hello"]]);

    h.sm.inputResult = { ok: false, error: "TEXT_EMPTY" };
    h.gw.input(sub, "s1", "   ");
    await Bun.sleep(0);
    const err = sub.sent.find((m): m is Extract<ServerMessage, { type: "error" }> => {
      return m.type === "error";
    });
    expect(err).toBeDefined();
    if (err) expect(err.code).toBe(ErrorCodes.INVALID_TEXT);
  } finally {
    h.close();
  }
});

test("prompt_response sukses -> notify prompt_resolved; gagal -> error", async () => {
  const h = freshHarness();
  try {
    h.store.insertPrompt(makePrompt("s1", "pr1", "permission"));
    const sub = makeSub("c1");
    h.gw.attach(sub, "s1");

    h.gw.promptResponse(sub, "s1", "pr1", "approve");
    await Bun.sleep(0);
    expect(h.sm.promptReplies).toEqual([["s1", "pr1", "approve"]]);
    const resolved = sub.sent.filter(
      (m): m is Extract<ServerMessage, { type: "prompt_resolved" }> => m.type === "prompt_resolved",
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.promptId).toBe("pr1");

    // Gagal -> error berkode PROMPT_FAILED (ditampilkan DI kartu oleh client)
    // dengan pesan ramah, tanpa notif resolved.
    h.sm.resolveResult = { ok: false, error: "PROMPT_NOT_FOUND" };
    h.gw.promptResponse(sub, "s1", "pr2", "approve");
    await Bun.sleep(0);
    const err = sub.sent.find((m): m is Extract<ServerMessage, { type: "error" }> => {
      return m.type === "error";
    });
    expect(err).toBeDefined();
    if (err) {
      expect(err.code).toBe(ErrorCodes.PROMPT_FAILED);
      expect(err.message).toContain("no longer waiting");
    }
    expect(sub.sent.filter((m) => m.type === "prompt_resolved")).toHaveLength(1);
  } finally {
    h.close();
  }
});

test("stop diteruskan; session tidak running -> error SESSION_NOT_RUNNING", () => {
  const h = freshHarness();
  try {
    const sub = makeSub("c1");
    h.gw.attach(sub, "s1");

    h.gw.stop(sub, "s1");
    expect(h.sm.stops).toEqual(["s1"]);

    h.sm.stopResult = { ok: false, error: "SESSION_NOT_RUNNING" };
    h.gw.stop(sub, "s1");
    const err = sub.sent.find((m): m is Extract<ServerMessage, { type: "error" }> => {
      return m.type === "error";
    });
    expect(err).toBeDefined();
    if (err) expect(err.code).toBe(ErrorCodes.SESSION_NOT_RUNNING);
  } finally {
    h.close();
  }
});

test("interrupt diteruskan ke interruptSession; gagal -> error dikirim", () => {
  const h = freshHarness();
  try {
    const sub = makeSub("c1");
    h.gw.attach(sub, "s1");

    h.gw.interrupt(sub, "s1");
    expect(h.sm.interrupts).toEqual(["s1"]);

    h.sm.interruptResult = { ok: false, error: "SESSION_NOT_FOUND" };
    h.gw.interrupt(sub, "s1");
    const err = sub.sent.find((m): m is Extract<ServerMessage, { type: "error" }> => {
      return m.type === "error";
    });
    expect(err).toBeDefined();
    if (err) expect(err.code).toBe(ErrorCodes.SESSION_NOT_FOUND);
  } finally {
    h.close();
  }
});

// ---------------------------------------------------------------------------
// Broadcast & isolasi kegagalan
// ---------------------------------------------------------------------------

test("notify*: broadcast ke seluruh subscriber Session; bukan ke Session lain", () => {
  const h = freshHarness();
  try {
    // Session kedua untuk membuktikan isolasi per-Session.
    h.store.insertSession({
      id: "s2",
      projectId: "p1",
      agentType: "opencode",
      cwd: "/x",
      status: "running",
      ocSessionId: "ses_2",
      model: null,
      agent: null,
      createdAt: 0,
      updatedAt: 0,
    });

    const subs = [makeSub("c1"), makeSub("c2"), makeSub("other")] as const;
    h.gw.attach(subs[0], "s1");
    h.gw.attach(subs[1], "s1");
    h.gw.attach(subs[2], "s2");
    h.gw.notifyMessage("s1", makeMessage("s1", "m1", "assistant"));
    h.gw.notifyMessagePart("s1", "m1", { type: "text", id: "prt_1", text: "stream" });
    h.gw.notifyPrompt("s1", makePrompt("s1", "pr1", "permission"));
    h.gw.notifySessionStatus("s1", "stopped");
    h.gw.notifyTurnActive("s1", true);
    h.gw.notifyPromptResolved("s1", "pr1");
    h.gw.notifyError("s1", "AGENT_ERROR", "gagal");

    for (const s of [subs[0], subs[1]]) {
      expect(s.sent.filter((m) => m.type === "message")).toHaveLength(1);
      expect(s.sent.filter((m) => m.type === "message_part")).toHaveLength(1);
      const part = s.sent.find((m): m is Extract<ServerMessage, { type: "message_part" }> => {
        return m.type === "message_part";
      });
      if (part) {
        expect(part.messageId).toBe("m1");
        expect(part.part).toEqual({ type: "text", id: "prt_1", text: "stream" });
      }
      const turn = s.sent.find(
        (m): m is Extract<ServerMessage, { type: "turn_active" }> => m.type === "turn_active",
      );
      expect(turn).toBeDefined();
      if (turn) expect(turn.active).toBe(true);
      expect(s.sent.filter((m) => m.type === "prompt")).toHaveLength(1);
      expect(s.sent.filter((m) => m.type === "session_status")).toHaveLength(1);
      expect(s.sent.filter((m) => m.type === "prompt_resolved")).toHaveLength(1);
      expect(s.sent.filter((m) => m.type === "error")).toHaveLength(1);
    }
    // Subscriber Session lain tidak menerima apa pun.
    expect(subs[2].sent.filter((m) => m.type === "message" || m.type === "prompt")).toHaveLength(0);
  } finally {
    h.close();
  }
});

test("Property 15/16: broadcast konsisten ke banyak client; client gagal diisolasi (5.3)", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 2, max: 6 }),
      fc.array(fc.boolean(), { minLength: 2, maxLength: 6 }),
      fc.array(fc.string({ maxLength: 20 }), { maxLength: 10 }),
      (clientCount, failFlags, msgIds) => {
        const h = freshHarness();
        try {
          const flags = Array.from(
            { length: clientCount },
            (_, i) => failFlags[i % failFlags.length],
          );
          const healthy = flags.filter((f) => !f).length;
          const subs = flags.map((f, i) => makeSub(`c${i}`, f));
          for (const s of subs) h.gw.attach(s, "s1");
          // Client yang send history gagal tidak terdaftar.
          expect(h.gw.subscriberCount("s1")).toBe(healthy);

          msgIds.forEach((id, i) => {
            h.gw.notifyMessage("s1", makeMessage("s1", `${id}-${i}`, "assistant"));
          });

          flags.forEach((f, i) => {
            const s = subs[i];
            if (!s) return;
            if (f) {
              expect(s.sent.filter((m) => m.type === "message")).toHaveLength(0);
            } else {
              const msgs = s.sent.filter(
                (m): m is Extract<ServerMessage, { type: "message" }> => m.type === "message",
              );
              expect(msgs).toHaveLength(msgIds.length);
              expect(msgs.map((m) => m.message.id)).toEqual(msgIds.map((id, j) => `${id}-${j}`));
            }
          });
          expect(h.gw.subscriberCount("s1")).toBe(healthy);
        } finally {
          h.close();
        }
      },
    ),
    { numRuns: 100 },
  );
});

// ---------------------------------------------------------------------------
// Dispatch pesan Client
// ---------------------------------------------------------------------------

test("dispatchClientMessage mengarahkan attach/input/prompt_response/stop/error", async () => {
  const h = freshHarness();
  try {
    const sub = makeSub("d1");
    dispatchClientMessage(h.gw, sub, JSON.stringify({ type: "attach", sessionId: "s1" }));
    expect(sub.sent.some((m) => m.type === "history")).toBe(true);

    dispatchClientMessage(
      h.gw,
      sub,
      JSON.stringify({ type: "input", sessionId: "s1", text: "halo" }),
    );
    await Bun.sleep(0);
    expect(h.sm.inputs).toEqual([["s1", "halo"]]);

    dispatchClientMessage(
      h.gw,
      sub,
      JSON.stringify({
        type: "prompt_response",
        sessionId: "s1",
        promptId: "p",
        response: "approve",
      }),
    );
    await Bun.sleep(0);
    expect(h.sm.promptReplies).toEqual([["s1", "p", "approve"]]);

    dispatchClientMessage(h.gw, sub, JSON.stringify({ type: "stop", sessionId: "s1" }));
    expect(h.sm.stops).toEqual(["s1"]);

    dispatchClientMessage(h.gw, sub, JSON.stringify({ type: "interrupt", sessionId: "s1" }));
    expect(h.sm.interrupts).toEqual(["s1"]);

    // interrupt tanpa sessionId -> INVALID_MESSAGE.
    dispatchClientMessage(h.gw, makeSub("d4"), JSON.stringify({ type: "interrupt" }));
    expect(h.sm.interrupts).toEqual(["s1"]);

    // JSON rusak / tipe tak dikenal
    const sub2 = makeSub("d2");
    dispatchClientMessage(h.gw, sub2, "bukan-json");
    expect(sub2.sent.some((m) => m.type === "error")).toBe(true);

    const sub3 = makeSub("d3");
    dispatchClientMessage(h.gw, sub3, JSON.stringify({ type: "bogus" }));
    const err = sub3.sent.find((m): m is Extract<ServerMessage, { type: "error" }> => {
      return m.type === "error";
    });
    expect(err).toBeDefined();
    if (err) expect(err.code).toBe("UNKNOWN_MESSAGE_TYPE");
  } finally {
    h.close();
  }
});
