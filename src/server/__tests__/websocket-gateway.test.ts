/**
 * Property & unit test `websocket-gateway.ts` (task 17).
 *
 * Property test:
 * - Property 6: Status Session tidak terpengaruh disconnect WebSocket (2.2)
 * - Property 11: Reattach mengirim riwayat sesuai urutan sebelum data baru (4.1)
 * - Property 12: Tidak ada duplikasi atau chunk terlewat setelah reattach (4.2)
 * - Property 13: Reattach ke Session tidak ditemukan menghasilkan error (4.3)
 * - Property 14: Reattach mengirim seluruh prompt belum resolved (4.4)
 * - Property 15: Broadcast konsisten ke banyak Client (5.1, 5.2)
 * - Property 16: Kegagalan satu Client tidak memengaruhi Client lain (5.3)
 *
 * Unit & wiring (17.5): input/prompt_response/resize -> Session_Manager,
 * notifikasi `session_status` & `prompt_resolved`, dispatch pesan.
 *
 * `Subscriber` (ws.send) dan `PtyHandle` di-mock seluruhnya sesuai batasan
 * mocking `design.md`.
 */
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import fc from "fast-check";
import { openSessionStore, type SessionStore } from "../db";
import type { PtyHandle } from "../pty-process";
import { createSessionManager, type SessionManager, type SpawnPtyFn } from "../session-manager";
import type { Project, SessionStatus } from "../types";
import {
  createWebSocketGateway,
  dispatchClientMessage,
  type Subscriber,
  type WebSocketGateway,
} from "../websocket-gateway";
import { ErrorCodes, type ServerMessage } from "../ws-protocol";

// ---------------------------------------------------------------------------
// Mock PtyHandle
// ---------------------------------------------------------------------------

interface PtyMock extends PtyHandle {
  writes: string[];
  kills: string[];
  resizes: [number, number][];
  emitData(chunk: string): void;
  emitExit(code: number | null): void;
}

function makePtyMock(sessionId: string): PtyMock {
  const writes: string[] = [];
  const kills: string[] = [];
  const resizes: [number, number][] = [];
  let dataCb: ((chunk: string) => void) | null = null;
  let exitCb: ((code: number | null, expected: boolean) => void) | null = null;
  let killRequested = false;

  return {
    sessionId,
    writes,
    kills,
    resizes,
    write(data: string) {
      writes.push(data);
    },
    resize(cols: number, rows: number) {
      resizes.push([cols, rows]);
    },
    kill(signal: "SIGTERM" | "SIGKILL" = "SIGTERM") {
      kills.push(signal);
      killRequested = true;
    },
    onData(cb) {
      dataCb = cb;
    },
    onExit(cb) {
      exitCb = cb;
    },
    emitData(chunk: string) {
      dataCb?.(chunk);
    },
    emitExit(code: number | null) {
      exitCb?.(code, killRequested);
    },
  };
}

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

type OutputMsg = Extract<ServerMessage, { type: "output" }>;
type PromptMsg = Extract<ServerMessage, { type: "prompt" }>;

function outputs(sent: ServerMessage[]): OutputMsg[] {
  return sent.filter((m): m is OutputMsg => m.type === "output");
}

// ---------------------------------------------------------------------------
// Harness: Session_Manager + Gateway ter-wire (onOutput / onStatusChange)
// ---------------------------------------------------------------------------

interface Harness {
  store: SessionStore;
  sm: SessionManager;
  gw: WebSocketGateway;
  handles: Map<string, PtyMock>;
  project: Project;
  root: string;
  close(): void;
}

function freshHarness(): Harness {
  const store = openSessionStore(":memory:");
  const root = mkdtempSync(path.join(tmpdir(), "kcg-wsg-"));
  const cwd = path.join(root, "proj");
  mkdirSync(cwd, { recursive: true });
  store.insertProject({ id: "p1", name: "proj", path: cwd, createdAt: 1 });

  const handles = new Map<string, PtyMock>();
  const spawn: SpawnPtyFn = (_cmd, _cwd, sessionId) => {
    const h = makePtyMock(sessionId);
    handles.set(sessionId, h);
    return h;
  };

  let gw: WebSocketGateway | null = null;
  const sm = createSessionManager({
    store,
    spawn,
    now: () => 1000,
    onOutput: (chunk) => gw?.broadcast(chunk.sessionId, chunk),
    onStatusChange: (sessionId, status) => gw?.notifySessionStatus(sessionId, status),
  });
  gw = createWebSocketGateway({ store, sessionManager: sm });

  return {
    store,
    sm,
    gw,
    handles,
    project: { id: "p1", name: "proj", path: cwd, createdAt: 1 },
    root,
    close() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function createRunningSession(h: Harness): string {
  const res = h.sm.createSession({ agentType: "opencode", projectId: h.project.id });
  expect(res.ok).toBe(true);
  if (!res.ok) throw new Error("harness: createSession gagal");
  return res.session.id;
}

function statusOf(store: SessionStore, sid: string): SessionStatus | undefined {
  const r = store.getSession(sid);
  return r.ok ? r.data.status : undefined;
}

// ---------------------------------------------------------------------------
// Property 6 — Status Session tidak terpengaruh disconnect WebSocket (2.2)
// ---------------------------------------------------------------------------

// Feature: kcg-bridge, Property 6: Status Session tidak terpengaruh disconnect WebSocket
test("Property 6: disconnect semua client -> status tetap running", () => {
  fc.assert(
    fc.property(fc.array(fc.string({ maxLength: 8 }), { maxLength: 5 }), (clientIds) => {
      const h = freshHarness();
      try {
        const sid = createRunningSession(h);
        const handle = h.handles.get(sid);

        const subs = clientIds.map((id) => makeSub(id));
        for (const s of subs) h.gw.attach(s, sid);
        expect(h.gw.subscriberCount(sid)).toBe(subs.length);

        // Disconnect seluruh koneksi (Requirement 2.2)
        for (const s of subs) h.gw.detach(s);
        expect(h.gw.subscriberCount(sid)).toBe(0);

        // Status tetap running, tanpa kill
        expect(statusOf(h.store, sid)).toBe("running");
        expect(handle?.kills ?? []).toEqual([]);

        // Output_Stream tetap mengalir ke store meski tanpa Client
        handle?.emitData("hello");
        const chunks = h.store.getOutputChunks(sid);
        expect(chunks.ok).toBe(true);
        if (chunks.ok) expect(chunks.data.map((c) => c.data)).toEqual(["hello"]);
      } finally {
        h.close();
      }
    }),
    { numRuns: 100 },
  );
});

// ---------------------------------------------------------------------------
// Property 11 — Reattach mengirim riwayat sesuai urutan sebelum data baru (4.1)
// ---------------------------------------------------------------------------

// Feature: kcg-bridge, Property 11: Reattach mengirim riwayat sesuai urutan sebelum data baru
test("Property 11: attach -> history urut seq; data baru seq lebih besar", () => {
  fc.assert(
    fc.property(fc.array(fc.string({ maxLength: 100 }), { maxLength: 30 }), (chunks) => {
      const h = freshHarness();
      try {
        const sid = createRunningSession(h);
        const handle = h.handles.get(sid);
        for (const c of chunks) handle?.emitData(c);

        const sub = makeSub("reattach");
        h.gw.attach(sub, sid);

        // history berisi seluruh chunk terurut seq naik (Requirement 4.1)
        const hist = sub.sent.find((m): m is Extract<ServerMessage, { type: "history" }> => {
          return m.type === "history";
        });
        expect(hist).toBeDefined();
        if (hist) {
          expect(hist.chunks).toHaveLength(chunks.length);
          expect(hist.chunks.map((c) => c.seq)).toEqual(chunks.map((_, i) => i + 1));
          expect(hist.chunks.map((c) => c.data)).toEqual(chunks);
        }

        // data baru setelah attach: seq > seluruh seq pada history
        handle?.emitData("setelah-attach");
        const out = outputs(sub.sent);
        expect(out).toHaveLength(1);
        expect(out[0]?.seq).toBe(chunks.length + 1);
      } finally {
        h.close();
      }
    }),
    { numRuns: 100 },
  );
});

// ---------------------------------------------------------------------------
// Property 12 — Tidak ada duplikasi atau chunk terlewat setelah reattach (4.2)
// ---------------------------------------------------------------------------

// Feature: kcg-bridge, Property 12: Tidak ada duplikasi atau chunk terlewat setelah reattach
test("Property 12: chunk basi tidak dikirim ulang; chunk baru tepat satu kali", () => {
  fc.assert(
    fc.property(
      fc.array(fc.string({ maxLength: 50 }), { maxLength: 10 }),
      fc.array(fc.tuple(fc.integer({ min: 1, max: 25 }), fc.string({ maxLength: 50 })), {
        maxLength: 25,
      }),
      (initChunks, newChunks) => {
        const h = freshHarness();
        try {
          const sid = createRunningSession(h);
          const handle = h.handles.get(sid);
          for (const c of initChunks) handle?.emitData(c);
          const base = initChunks.length;

          const sub = makeSub("cursor");
          h.gw.attach(sub, sid);

          // chunk dengan seq <= cursor (lastSeqSent) tidak boleh dikirim ulang
          const stale = new Set<number>();
          for (const [s] of newChunks) if (s <= base) stale.add(s);
          stale.add(base);
          for (const s of stale) {
            h.gw.broadcast(sid, { sessionId: sid, seq: s, data: "stale", ts: 0 });
          }

          // chunk baru (seq > cursor), dedup, urut naik
          const seen = new Set<number>();
          const fresh: [number, string][] = [];
          for (const [s, d] of newChunks) {
            if (s <= base || seen.has(s)) continue;
            seen.add(s);
            fresh.push([s, d]);
          }
          fresh.sort((a, b) => a[0] - b[0]);
          for (const [s, d] of fresh) {
            h.gw.broadcast(sid, { sessionId: sid, seq: s, data: d, ts: 0 });
          }

          const out = outputs(sub.sent);
          expect(out.length).toBe(fresh.length);
          expect(out.map((o) => o.seq)).toEqual(fresh.map(([s]) => s));
          expect(out.map((o) => o.data)).toEqual(fresh.map(([, d]) => d));
        } finally {
          h.close();
        }
      },
    ),
    { numRuns: 100 },
  );
});

// ---------------------------------------------------------------------------
// Property 13 — Reattach ke Session tidak ditemukan menghasilkan error (4.3)
// ---------------------------------------------------------------------------

// Feature: kcg-bridge, Property 13: Reattach ke Session tidak ditemukan menghasilkan error
test("Property 13: attach session tak dikenal -> error + close, tanpa history/output", () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 20 }), (unknownId) => {
      const h = freshHarness();
      try {
        const sub = makeSub("c1");
        h.gw.attach(sub, unknownId);

        // error SESSION_NOT_FOUND dikirim sebelum koneksi ditutup (Req 4.3)
        const err = sub.sent.find((m): m is Extract<ServerMessage, { type: "error" }> => {
          return m.type === "error";
        });
        expect(err).toBeDefined();
        if (err) expect(err.code).toBe(ErrorCodes.SESSION_NOT_FOUND);
        expect(sub.closed).toBe(true);

        // tidak ada history / output yang dikirim
        expect(sub.sent.some((m) => m.type === "history")).toBe(false);
        expect(sub.sent.some((m) => m.type === "output")).toBe(false);
        // subscriber tidak terdaftar
        expect(h.gw.subscriberCount(unknownId)).toBe(0);
      } finally {
        h.close();
      }
    }),
    { numRuns: 100 },
  );
});

// ---------------------------------------------------------------------------
// Property 14 — Reattach mengirim seluruh prompt belum resolved (4.4)
// ---------------------------------------------------------------------------

// Feature: kcg-bridge, Property 14: Reattach mengirim seluruh prompt belum resolved
test("Property 14: attach -> prompt pending terkirim semua, resolved tidak", () => {
  fc.assert(
    fc.property(
      fc.array(fc.constantFrom("pending", "resolved" as const), { maxLength: 20 }),
      (statuses) => {
        const h = freshHarness();
        try {
          const sid = createRunningSession(h);
          statuses.forEach((st, i) => {
            h.store.insertPrompt({
              id: `pr-${i}`,
              sessionId: sid,
              type: "confirmation",
              options: null,
              status: st,
              createdAt: i,
              resolvedAt: st === "resolved" ? 999 : null,
            });
          });

          const sub = makeSub("c1");
          h.gw.attach(sub, sid);

          const prompts = sub.sent.filter((m): m is PromptMsg => m.type === "prompt");
          const expectedIds = statuses
            .map((s, i) => (s === "pending" ? `pr-${i}` : null))
            .filter((x): x is string => x !== null);

          // tepat satu pesan prompt per prompt pending, tidak ada yang resolved
          expect(prompts.map((p) => p.prompt.id).sort()).toEqual(expectedIds.sort());
          for (const p of prompts) expect(p.prompt.status).toBe("pending");
        } finally {
          h.close();
        }
      },
    ),
    { numRuns: 100 },
  );
});

// ---------------------------------------------------------------------------
// Property 15 — Broadcast konsisten ke banyak Client (5.1, 5.2)
// ---------------------------------------------------------------------------

// Feature: kcg-bridge, Property 15: Broadcast konsisten ke banyak Client
test("Property 15: setiap client menerima seluruh chunk sekali, urut identik", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 2, max: 6 }),
      fc.array(fc.string({ maxLength: 40 }), { maxLength: 20 }),
      (clientCount, chunkData) => {
        const h = freshHarness();
        try {
          const sid = createRunningSession(h);
          const subs = Array.from({ length: clientCount }, (_, i) => makeSub(`c${i}`));
          for (const s of subs) h.gw.attach(s, sid);

          chunkData.forEach((d, i) => {
            h.gw.broadcast(sid, { sessionId: sid, seq: i + 1, data: d, ts: 0 });
          });

          for (const s of subs) {
            const out = outputs(s.sent);
            expect(out.map((o) => o.seq)).toEqual(chunkData.map((_, i) => i + 1));
            expect(out.map((o) => o.data)).toEqual(chunkData);
          }
        } finally {
          h.close();
        }
      },
    ),
    { numRuns: 100 },
  );
});

// ---------------------------------------------------------------------------
// Property 16 — Kegagalan satu Client tidak memengaruhi Client lain (5.3)
// ---------------------------------------------------------------------------

// Feature: kcg-bridge, Property 16: Kegagalan satu Client tidak memengaruhi Client lain
test("Property 16: client gagal dihapus; client lain tetap lengkap & urut", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 2, max: 6 }),
      fc
        .array(fc.boolean(), { minLength: 2, maxLength: 6 })
        .filter((flags) => flags.some((f) => !f)),
      fc.array(fc.string({ maxLength: 40 }), { minLength: 1, maxLength: 15 }),
      (clientCount, failFlags, chunkData) => {
        const h = freshHarness();
        try {
          const sid = createRunningSession(h);
          const flags = Array.from(
            { length: clientCount },
            (_, i) => failFlags[i % failFlags.length],
          );
          const healthy = flags.filter((f) => !f).length;
          const subs = flags.map((f, i) => makeSub(`c${i}`, f));
          for (const s of subs) h.gw.attach(s, sid);
          // Client yang send-nya gagal ditolak saat attach (send history gagal),
          // sehingga hanya client sehat yang terdaftar.
          expect(h.gw.subscriberCount(sid)).toBe(healthy);

          chunkData.forEach((d, i) => {
            h.gw.broadcast(sid, { sessionId: sid, seq: i + 1, data: d, ts: 0 });
          });

          // client sehat: lengkap & berurutan (Req 5.3); client gagal: tanpa output
          flags.forEach((f, i) => {
            const s = subs[i];
            if (!s) return;
            if (f) {
              expect(outputs(s.sent)).toHaveLength(0);
            } else {
              const out = outputs(s.sent);
              expect(out.map((o) => o.seq)).toEqual(chunkData.map((_, i) => i + 1));
              expect(out.map((o) => o.data)).toEqual(chunkData);
            }
          });

          // registry hanya berisi client sehat
          expect(h.gw.subscriberCount(sid)).toBe(healthy);
        } finally {
          h.close();
        }
      },
    ),
    { numRuns: 100 },
  );
});

// ---------------------------------------------------------------------------
// Task 17.5 — wiring pesan Client -> Session_Manager & notifikasi
// ---------------------------------------------------------------------------

test("17.5: input diteruskan ke Session_Manager; input invalid -> error", () => {
  const h = freshHarness();
  try {
    const sid = createRunningSession(h);
    const handle = h.handles.get(sid);
    const sub = makeSub("c1");
    h.gw.attach(sub, sid);

    h.gw.input(sub, sid, "hello world");
    expect(handle?.writes).toEqual(["hello world\n"]);

    // free-text invalid -> error INVALID_TEXT
    h.gw.input(sub, sid, "   ");
    const err = sub.sent.find((m): m is Extract<ServerMessage, { type: "error" }> => {
      return m.type === "error";
    });
    expect(err).toBeDefined();
    if (err) expect(err.code).toBe(ErrorCodes.INVALID_TEXT);
    expect(handle?.writes).toEqual(["hello world\n"]);
  } finally {
    h.close();
  }
});

test("17.5: prompt_response -> resolvePrompt + notif prompt_resolved; invalid -> error", () => {
  const h = freshHarness();
  try {
    const sid = createRunningSession(h);
    const handle = h.handles.get(sid);
    const sub = makeSub("c1");
    h.gw.attach(sub, sid);

    h.store.insertPrompt({
      id: "c1",
      sessionId: sid,
      type: "confirmation",
      options: null,
      status: "pending",
      createdAt: 1,
      resolvedAt: null,
    });

    h.gw.promptResponse(sub, sid, "c1", "approve");
    expect(handle?.writes).toEqual(["y\n"]);

    const resolved = sub.sent.filter(
      (m): m is Extract<ServerMessage, { type: "prompt_resolved" }> => {
        return m.type === "prompt_resolved";
      },
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.promptId).toBe("c1");

    // respon kedua (sudah resolved) -> error, tanpa notif resolved tambahan
    h.gw.promptResponse(sub, sid, "c1", "deny");
    const err = sub.sent.find((m): m is Extract<ServerMessage, { type: "error" }> => {
      return m.type === "error";
    });
    expect(err).toBeDefined();
    if (err) expect(err.code).toBe(ErrorCodes.PROMPT_ALREADY_RESOLVED);
    expect(sub.sent.filter((m) => m.type === "prompt_resolved")).toHaveLength(1);
  } finally {
    h.close();
  }
});

test("17.5: resize diteruskan ke Session_Manager; ukuran invalid -> error", () => {
  const h = freshHarness();
  try {
    const sid = createRunningSession(h);
    const handle = h.handles.get(sid);
    const sub = makeSub("c1");
    h.gw.attach(sub, sid);

    h.gw.resize(sub, sid, 120, 40);
    expect(handle?.resizes).toEqual([[120, 40]]);

    h.gw.resize(sub, sid, 0, 40);
    const err = sub.sent.find((m): m is Extract<ServerMessage, { type: "error" }> => {
      return m.type === "error";
    });
    expect(err).toBeDefined();
    if (err) expect(err.code).toBe(ErrorCodes.INVALID_SIZE);
    expect(handle?.resizes).toEqual([[120, 40]]);
  } finally {
    h.close();
  }
});

test("notifyPrompt: prompt baru terkirim ke seluruh subscriber Session", () => {
  const h = freshHarness();
  try {
    const sid = createRunningSession(h);
    const subs = [makeSub("c1"), makeSub("c2")];
    for (const s of subs) h.gw.attach(s, sid);

    h.gw.notifyPrompt(sid, {
      id: "np1",
      sessionId: sid,
      type: "confirmation",
      options: null,
      status: "pending",
      createdAt: 1,
      resolvedAt: null,
    });

    for (const s of subs) {
      const prompts = s.sent.filter((m): m is PromptMsg => m.type === "prompt");
      expect(prompts).toHaveLength(1);
      expect(prompts[0]?.prompt.id).toBe("np1");
    }
  } finally {
    h.close();
  }
});

test("17.5: onStatusChange -> client menerima session_status saat proses exit", () => {
  const h = freshHarness();
  try {
    const sid = createRunningSession(h);
    const handle = h.handles.get(sid);
    const sub = makeSub("c1");
    h.gw.attach(sub, sid);

    // exit tak terduga kode bukan nol -> crashed
    handle?.emitExit(1);
    expect(statusOf(h.store, sid)).toBe("crashed");

    const st = sub.sent.find((m): m is Extract<ServerMessage, { type: "session_status" }> => {
      return m.type === "session_status";
    });
    expect(st).toBeDefined();
    if (st) expect(st.status).toBe("crashed");
  } finally {
    h.close();
  }
});

test("17.1: dispatchClientMessage mengarahkan pesan sesuai tipe", () => {
  const h = freshHarness();
  try {
    const sid = createRunningSession(h);
    const handle = h.handles.get(sid);

    // attach lewat dispatch
    const sub = makeSub("d1");
    dispatchClientMessage(h.gw, sub, JSON.stringify({ type: "attach", sessionId: sid }));
    expect(sub.sent.some((m) => m.type === "history")).toBe(true);

    // input lewat dispatch
    dispatchClientMessage(
      h.gw,
      sub,
      JSON.stringify({ type: "input", sessionId: sid, text: "halo" }),
    );
    expect(handle?.writes).toContain("halo\n");

    // JSON rusak -> error INVALID_MESSAGE
    const sub2 = makeSub("d2");
    dispatchClientMessage(h.gw, sub2, "bukan-json");
    expect(sub2.sent.some((m) => m.type === "error")).toBe(true);

    // tipe tak dikenal -> error UNKNOWN_MESSAGE_TYPE
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
