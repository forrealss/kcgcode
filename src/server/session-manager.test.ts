/**
 * Property, unit & integration test `session-manager.ts` (task 11, 12, 14).
 *
 * Property test:
 * - Property 1: Pembuatan Session valid (1.1, 1.2, 10.9)
 * - Property 2: Kondisi tidak valid selalu ditolak (1.3, 10.10, 10.11)
 * - Property 3: Daftar entitas selalu lengkap (1.5, 10.8)
 * - Property 4: Penghentian Session tidak valid selalu ditolak (1.7)
 * - Property 5: Exit tak terduga -> crashed (1.8)
 * - Property 7: Rekonsiliasi startup menandai Session tanpa proses crashed (2.4)
 * - Property 18-20: Resolusi Interactive_Prompt (6.3-6.7)
 * - Property 21-24: Free-text input (7.1-7.5)
 *
 * Unit & integration:
 * - 11.3: kegagalan spawn (1.4)
 * - 12.3: timing force-kill SIGKILL (1.6)
 * - 12.9: proses tetap hidup & shutdown dalam budget (2.1, 2.3)
 *
 * `PtyHandle` di-mock seluruhnya sesuai batasan mocking `design.md`.
 */
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import fc from "fast-check";
import type { SessionStore } from "./db";
import { openSessionStore } from "./db";
import type { PtyHandle } from "./pty-process";
import {
  type CreateSessionRequest,
  createSessionManager,
  type SessionManager,
  type SpawnPtyFn,
} from "./session-manager";
import type { AgentType, Project, Session, SessionStatus } from "./types";

// ---------------------------------------------------------------------------
// Mock PtyHandle + harness
// ---------------------------------------------------------------------------

interface PtyMock extends PtyHandle {
  writes: string[];
  kills: string[];
  emitData(chunk: string): void;
  emitExit(code: number | null): void;
}

function makePtyMock(sessionId: string, opts: { immediateExitCode?: number | null } = {}): PtyMock {
  const writes: string[] = [];
  const kills: string[] = [];
  let dataCb: ((chunk: string) => void) | null = null;
  let exitCb: ((code: number | null, expected: boolean) => void) | null = null;
  let killRequested = false;

  return {
    sessionId,
    writes,
    kills,
    write(data: string) {
      writes.push(data);
    },
    resize() {},
    kill(signal: "SIGTERM" | "SIGKILL" = "SIGTERM") {
      kills.push(signal);
      killRequested = true;
    },
    onData(cb) {
      dataCb = cb;
    },
    onExit(cb) {
      exitCb = cb;
      // Proses langsung exit saat listener dipasang (task 11.3).
      if (opts.immediateExitCode !== undefined) cb(opts.immediateExitCode, false);
    },
    emitData(chunk: string) {
      dataCb?.(chunk);
    },
    emitExit(code: number | null) {
      exitCb?.(code, killRequested);
    },
  };
}

interface Harness {
  store: SessionStore;
  sm: SessionManager;
  handles: Map<string, PtyMock>;
  spawned: { cmd: string[]; cwd: string; sessionId: string }[];
  project: Project;
  root: string;
  close(): void;
}

interface HarnessOptions {
  spawn?: SpawnPtyFn;
  setTimeoutFn?: (cb: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

function freshHarness(opts: HarnessOptions = {}): Harness {
  const store = openSessionStore(":memory:");
  const root = mkdtempSync(path.join(tmpdir(), "kcg-sm-"));
  const cwd = path.join(root, "proj");
  mkdirSync(cwd, { recursive: true });
  const project: Project = { id: "p1", name: "proj", path: cwd, createdAt: 1 };
  store.insertProject(project);

  const handles = new Map<string, PtyMock>();
  const spawned: { cmd: string[]; cwd: string; sessionId: string }[] = [];
  const defaultSpawn: SpawnPtyFn = (cmd, cwdArg, sessionId) => {
    const h = makePtyMock(sessionId);
    spawned.push({ cmd, cwd: cwdArg, sessionId });
    handles.set(sessionId, h);
    return h;
  };

  const sm = createSessionManager({
    store,
    spawn: opts.spawn ?? defaultSpawn,
    now: () => 1000,
    ...(opts.setTimeoutFn ? { setTimeoutFn: opts.setTimeoutFn } : {}),
    ...(opts.clearTimeoutFn ? { clearTimeoutFn: opts.clearTimeoutFn } : {}),
  });

  return {
    store,
    sm,
    handles,
    spawned,
    project,
    root,
    close() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** Status tersimpan sebuah Session, atau undefined bila tidak ditemukan. */
function statusOf(store: SessionStore, sid: string): SessionStatus | undefined {
  const r = store.getSession(sid);
  return r.ok ? r.data.status : undefined;
}

// ---------------------------------------------------------------------------
// Task 11 — pembuatan & daftar Session
// ---------------------------------------------------------------------------

// Feature: kcg-bridge, Property 1: Pembuatan Session valid
test("Property 1: createSession valid -> running, cwd project, satu PtyHandle", () => {
  fc.assert(
    fc.property(fc.constantFrom("opencode", "claude-code" as const), (agentType) => {
      const h = freshHarness();
      try {
        const res = h.sm.createSession({ agentType, projectId: h.project.id });
        expect(res.ok).toBe(true);
        if (res.ok) {
          expect(res.session.status).toBe("running");
          expect(res.session.cwd).toBe(h.project.path);
          expect(res.session.agentType).toBe(agentType);
          expect(res.session.createdAt).toBe(1000);
          // Tepat satu PtyHandle terasosiasi (Requirement 1.2)
          expect(h.handles.has(res.session.id)).toBe(true);
          // Perintah CLI_Agent sesuai tipe
          expect(h.spawned[0]?.cmd).toEqual(
            agentType === "opencode" ? ["opencode"] : ["claude-code"],
          );
          expect(h.spawned[0]?.cwd).toBe(h.project.path);
        }
      } finally {
        h.close();
      }
    }),
    { numRuns: 100 },
  );
});

// Feature: kcg-bridge, Property 2: Pembuatan Session dengan kondisi tidak valid selalu ditolak
test("Property 2: agentType tidak didukung / project tidak ada / dir hilang -> ditolak", () => {
  fc.assert(
    fc.property(
      fc.constantFrom("vibe", "codex", "terraform"),
      fc.string({ maxLength: 20 }).filter((s) => s !== "p1"),
      fc.constantFrom(0, 1, 2),
      (badType, unknownId, kase) => {
        const h = freshHarness();
        try {
          let req: CreateSessionRequest;
          if (kase === 0) {
            // (1) agentType di luar daftar didukung
            req = { agentType: badType as AgentType, projectId: h.project.id };
          } else if (kase === 1) {
            // (2) projectId tidak ada di Session_Store
            req = { agentType: "opencode", projectId: unknownId };
          } else {
            // (3) Project valid namun direktori kerjanya sudah tidak ada
            h.store.insertProject({
              id: "pm",
              name: "proj-missing",
              path: path.join(h.root, "tidak-ada-dir"),
              createdAt: 1,
            });
            req = { agentType: "opencode", projectId: "pm" };
          }

          const res = h.sm.createSession(req);
          expect(res.ok).toBe(false);
          if (!res.ok) expect(res.error.length).toBeGreaterThan(0);
          // Tidak ada baris sessions berstatus running (Requirement 1.3, 10.10, 10.11)
          expect(h.store.listSessions().every((s) => s.status !== "running")).toBe(true);
        } finally {
          h.close();
        }
      },
    ),
    { numRuns: 100 },
  );
});

// Feature: kcg-bridge, Property 3: Daftar entitas selalu lengkap
test("Property 3: listSessions & listProjects selalu lengkap tanpa duplikat", () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.tuple(
          fc.string({ minLength: 1, maxLength: 12 }),
          fc.string({ minLength: 1, maxLength: 12 }),
        ),
        { maxLength: 8 },
      ),
      fc.array(fc.constantFrom("running", "stopped", "crashed" as const), { maxLength: 8 }),
      (projSpecs, statuses) => {
        const h = freshHarness();
        try {
          const insertedProjects: Project[] = [];
          projSpecs.forEach(([name, rel], i) => {
            const proj: Project = {
              id: `pj-${i}`,
              name,
              path: path.join(h.root, rel),
              createdAt: i,
            };
            if (h.store.insertProject(proj).ok) insertedProjects.push(proj);
          });

          const insertedSessions: Session[] = [];
          statuses.forEach((status, i) => {
            const proj = insertedProjects[i % Math.max(1, insertedProjects.length)];
            if (!proj) return;
            const s: Session = {
              id: `s-${i}`,
              projectId: proj.id,
              agentType: "opencode",
              cwd: proj.path,
              status,
              createdAt: i,
              updatedAt: i,
            };
            if (h.store.insertSession(s).ok) insertedSessions.push(s);
          });

          // listSessions lengkap, tanpa hilang/duplikat (Requirement 1.5)
          const listed = h.sm.listSessions();
          expect(listed.length).toBe(insertedSessions.length);
          const ids = new Set(listed.map((s) => s.id));
          expect(ids.size).toBe(listed.length);
          for (const s of insertedSessions) expect(ids.has(s.id)).toBe(true);

          // listProjects lengkap, termasuk project bawaan harness (Req 10.8)
          const projs = h.store.listProjects();
          expect(projs.length).toBe(insertedProjects.length + 1);
          const projIds = new Set(projs.map((p) => p.id));
          expect(projIds.size).toBe(projs.length);
          for (const p of insertedProjects) expect(projIds.has(p.id)).toBe(true);
          expect(projIds.has(h.project.id)).toBe(true);
        } finally {
          h.close();
        }
      },
    ),
    { numRuns: 100 },
  );
});

test("11.3: spawn melempar error -> sesi dicatat crashed, tidak pernah running", () => {
  const store = openSessionStore(":memory:");
  const root = mkdtempSync(path.join(tmpdir(), "kcg-sm-"));
  const cwd = path.join(root, "proj");
  mkdirSync(cwd, { recursive: true });
  store.insertProject({ id: "p1", name: "proj", path: cwd, createdAt: 1 });

  const sm = createSessionManager({
    store,
    now: () => 1000,
    spawn: () => {
      throw new Error("command not found");
    },
  });

  const res = sm.createSession({ agentType: "opencode", projectId: "p1" });
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.error).toContain("PROCESS_SPAWN_FAILED");

  const sessions = store.listSessions();
  expect(sessions).toHaveLength(1);
  expect(sessions[0]?.status).toBe("crashed");
  const hist = store.getStatusHistory(sessions[0]?.id ?? "");
  expect(hist.ok).toBe(true);
  if (hist.ok) expect(hist.data.map((x) => x.status)).toEqual(["crashed"]);
  store.close();
  rmSync(root, { recursive: true, force: true });
});

test("11.3: proses langsung exit dengan error -> sesi dicatat crashed", () => {
  const store = openSessionStore(":memory:");
  const root = mkdtempSync(path.join(tmpdir(), "kcg-sm-"));
  const cwd = path.join(root, "proj");
  mkdirSync(cwd, { recursive: true });
  store.insertProject({ id: "p1", name: "proj", path: cwd, createdAt: 1 });

  const sm = createSessionManager({
    store,
    now: () => 1000,
    spawn: (_cmd, _cwd, sessionId) => makePtyMock(sessionId, { immediateExitCode: 1 }),
  });

  const res = sm.createSession({ agentType: "opencode", projectId: "p1" });
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.error).toContain("PROCESS_SPAWN_FAILED");

  const sessions = store.listSessions();
  expect(sessions).toHaveLength(1);
  expect(sessions[0]?.status).toBe("crashed");
  const hist = store.getStatusHistory(sessions[0]?.id ?? "");
  expect(hist.ok).toBe(true);
  if (hist.ok) expect(hist.data.map((x) => x.status)).toEqual(["crashed"]);
  store.close();
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Task 12 — lifecycle (stop, exit, rekonsiliasi, shutdown)
// ---------------------------------------------------------------------------

// Feature: kcg-bridge, Property 4: Penghentian Session tidak valid selalu ditolak
test("Property 4: stopSession id tak dikenal / status bukan running -> ditolak", () => {
  fc.assert(
    fc.property(
      fc.string({ maxLength: 20 }),
      fc.constantFrom("stopped", "crashed" as const),
      (unknownId, nonRunning) => {
        const h = freshHarness();
        try {
          // Session tidak ditemukan
          const r1 = h.sm.stopSession(unknownId);
          expect(r1.ok).toBe(false);
          if (!r1.ok) expect(r1.error).toBe("SESSION_NOT_FOUND");

          // Session berstatus bukan running
          const created = h.sm.createSession({ agentType: "opencode", projectId: h.project.id });
          expect(created.ok).toBe(true);
          if (!created.ok) return;
          const sid = created.session.id;
          const handle = h.handles.get(sid);
          expect(handle).toBeDefined();
          if (nonRunning === "stopped") {
            handle?.kill("SIGTERM");
            handle?.emitExit(0);
          } else {
            handle?.emitExit(1);
          }
          expect(statusOf(h.store, sid)).toBe(nonRunning);

          const killsBefore = handle?.kills.length ?? 0;
          const r2 = h.sm.stopSession(sid);
          expect(r2.ok).toBe(false);
          if (!r2.ok) expect(r2.error).toBe("SESSION_NOT_RUNNING");
          // Status tidak berubah & tidak ada sinyal baru (Requirement 1.7)
          expect(statusOf(h.store, sid)).toBe(nonRunning);
          expect(handle?.kills.length ?? 0).toBe(killsBefore);
        } finally {
          h.close();
        }
      },
    ),
    { numRuns: 100 },
  );
});

// Feature: kcg-bridge, Property 5: Exit tak terduga menghasilkan status crashed
test("Property 5: exit tak terduga kode bukan nol -> crashed + riwayat tercatat", () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 255 }), (code) => {
      const h = freshHarness();
      try {
        const res = h.sm.createSession({ agentType: "opencode", projectId: h.project.id });
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        const sid = res.session.id;

        const before = h.store.getStatusHistory(sid);
        const beforeCount = before.ok ? before.data.length : 0;

        const handle = h.handles.get(sid);
        expect(handle).toBeDefined();
        handle?.emitExit(code);

        const cur = h.store.getSession(sid);
        expect(cur.ok).toBe(true);
        if (cur.ok) expect(cur.data.status).toBe("crashed");

        const hist = h.store.getStatusHistory(sid);
        expect(hist.ok).toBe(true);
        if (hist.ok) {
          expect(hist.data.length).toBe(beforeCount + 1);
          const last = hist.data[hist.data.length - 1];
          expect(last).toBeDefined();
          if (last) {
            expect(last.status).toBe("crashed");
            expect(last.changedAt).toBe(1000); // timestamp kejadian
          }
        }
      } finally {
        h.close();
      }
    }),
    { numRuns: 100 },
  );
});

// Feature: kcg-bridge, Property 7: Rekonsiliasi startup menandai Session tanpa proses sebagai crashed
test("Property 7: reconcileOnStartup -> running jadi crashed, lainnya tidak berubah", () => {
  fc.assert(
    fc.property(
      fc.array(fc.constantFrom("running", "stopped", "crashed" as const), { maxLength: 30 }),
      (statuses) => {
        const h = freshHarness();
        try {
          const inserted: { id: string; status: SessionStatus }[] = [];
          statuses.forEach((status, i) => {
            const s: Session = {
              id: `rc-${i}`,
              projectId: h.project.id,
              agentType: "opencode",
              cwd: h.project.path,
              status,
              createdAt: i,
              updatedAt: i,
            };
            if (h.store.insertSession(s).ok) inserted.push({ id: `rc-${i}`, status });
          });

          h.sm.reconcileOnStartup();

          for (const s of inserted) {
            const cur = h.store.getSession(s.id);
            const expected = s.status === "running" ? "crashed" : s.status;
            expect(cur.ok).toBe(true);
            if (cur.ok) expect(cur.data.status).toBe(expected);

            const hist = h.store.getStatusHistory(s.id);
            expect(hist.ok).toBe(true);
            if (hist.ok) {
              if (s.status === "running") {
                expect(hist.data).toHaveLength(1);
                expect(hist.data[0]?.status).toBe("crashed");
              } else {
                expect(hist.data).toHaveLength(0);
              }
            }
          }
        } finally {
          h.close();
        }
      },
    ),
    { numRuns: 100 },
  );
});

test("12.4: exit tak terduga kode 0 -> stopped (proses selesai bersih)", () => {
  const h = freshHarness();
  try {
    const res = h.sm.createSession({ agentType: "opencode", projectId: h.project.id });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const sid = res.session.id;
    const handle = h.handles.get(sid);
    expect(handle).toBeDefined();

    handle?.emitExit(0);
    expect(statusOf(h.store, sid)).toBe("stopped");
    // Manager tidak lagi menganggapnya berjalan (proses sudah tidak ada)
    expect(h.sm.stopSession(sid)).toEqual({ ok: false, error: "SESSION_NOT_RUNNING" });
  } finally {
    h.close();
  }
});

// ---- Task 12.3: timing force-kill dengan fake timer ----
interface FakeTimers {
  timers: Map<number, { cb: () => void; delay: number }>;
  setTimeoutFn: (cb: () => void, ms: number) => unknown;
  clearTimeoutFn: (handle: unknown) => void;
}

function fakeTimers(): FakeTimers {
  const timers = new Map<number, { cb: () => void; delay: number }>();
  let nextId = 1;
  return {
    timers,
    setTimeoutFn: (cb, ms) => {
      const id = nextId;
      nextId += 1;
      timers.set(id, { cb, delay: ms });
      return id;
    },
    clearTimeoutFn: (handle) => {
      timers.delete(handle as number);
    },
  };
}

test("12.3: SIGKILL dikirim setelah 5 detik bila proses belum keluar", () => {
  const ft = fakeTimers();
  const h = freshHarness({ setTimeoutFn: ft.setTimeoutFn, clearTimeoutFn: ft.clearTimeoutFn });
  try {
    const res = h.sm.createSession({ agentType: "opencode", projectId: h.project.id });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const sid = res.session.id;
    const handle = h.handles.get(sid);
    expect(handle).toBeDefined();

    const stop = h.sm.stopSession(sid);
    expect(stop.ok).toBe(true);
    expect(handle?.kills).toEqual(["SIGTERM"]);

    // Tepat satu timer force-kill dijadwalkan 5 detik (Requirement 1.6)
    expect(ft.timers.size).toBe(1);
    const entries = [...ft.timers.entries()];
    expect(entries[0]?.[1].delay).toBe(5000);

    // Proses belum keluar setelah 5 detik -> SIGKILL dikirim
    const [, timer] = entries[0] ?? [];
    timer?.cb();
    expect(handle?.kills).toEqual(["SIGTERM", "SIGKILL"]);

    // Setelah SIGKILL, proses keluar -> stopped & timer dibersihkan
    handle?.emitExit(null);
    expect(statusOf(h.store, sid)).toBe("stopped");
    expect(ft.timers.size).toBe(0);
  } finally {
    h.close();
  }
});

test("12.3: proses keluar sebelum 5 detik -> timer dibatalkan, tanpa SIGKILL", () => {
  const ft = fakeTimers();
  const h = freshHarness({ setTimeoutFn: ft.setTimeoutFn, clearTimeoutFn: ft.clearTimeoutFn });
  try {
    const res = h.sm.createSession({ agentType: "opencode", projectId: h.project.id });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const sid = res.session.id;
    const handle = h.handles.get(sid);

    const stop = h.sm.stopSession(sid);
    expect(stop.ok).toBe(true);
    expect(ft.timers.size).toBe(1);

    // Proses keluar lebih awal -> tidak ada SIGKILL, timer dibatalkan
    handle?.emitExit(0);
    expect(ft.timers.size).toBe(0);
    expect(handle?.kills).toEqual(["SIGTERM"]);
    expect(statusOf(h.store, sid)).toBe("stopped");
  } finally {
    h.close();
  }
});

// ---- Task 12.9: integration test persistensi proses & shutdown ----
test("12.9: proses tetap hidup & status running tanpa Client; shutdown simpan status running", async () => {
  const h = freshHarness();
  try {
    const created: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = h.sm.createSession({ agentType: "opencode", projectId: h.project.id });
      expect(res.ok).toBe(true);
      if (res.ok) created.push(res.session.id);
    }

    // Tidak ada Client terhubung: PtyHandle tetap hidup, tanpa kill, status running
    // (Requirement 2.1, 2.2)
    for (const id of created) {
      const handle = h.handles.get(id);
      expect(handle).toBeDefined();
      expect(handle?.kills).toEqual([]);
      expect(statusOf(h.store, id)).toBe("running");
    }

    // Shutdown menyimpan status seluruh Session running dalam budget 5 detik (2.3)
    const t0 = Date.now();
    await h.sm.shutdown();
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(5000);

    for (const id of created) {
      const hist = h.store.getStatusHistory(id);
      expect(hist.ok).toBe(true);
      if (hist.ok) {
        expect(hist.data.map((x) => x.status)).toContain("running");
      }
    }
  } finally {
    h.close();
  }
});

// ---------------------------------------------------------------------------
// Task 14 — free-text input & resolusi Interactive_Prompt
// ---------------------------------------------------------------------------

// Feature: kcg-bridge, Property 18: Respon valid diteruskan dan menandai prompt resolved
test("Property 18: approve/deny/opsi menu diteruskan & prompt resolved", () => {
  fc.assert(
    fc.property(
      fc.constantFrom("approve", "deny" as const),
      fc.constantFrom("opA", "opB", "opC"),
      (simpleResp, option) => {
        const h = freshHarness();
        try {
          const res = h.sm.createSession({ agentType: "opencode", projectId: h.project.id });
          expect(res.ok).toBe(true);
          if (!res.ok) return;
          const sid = res.session.id;
          const handle = h.handles.get(sid);
          expect(handle).toBeDefined();

          // Confirmation: approve -> "y\n", deny -> "n\n"
          h.store.insertPrompt({
            id: "c1",
            sessionId: sid,
            type: "confirmation",
            options: null,
            status: "pending",
            createdAt: 1,
            resolvedAt: null,
          });
          const r1 = h.sm.resolvePrompt(sid, "c1", simpleResp);
          expect(r1.ok).toBe(true);
          expect(handle?.writes).toEqual([simpleResp === "approve" ? "y\n" : "n\n"]);
          const p1 = h.store.getPrompt("c1");
          expect(p1.ok).toBe(true);
          if (p1.ok) {
            expect(p1.data.status).toBe("resolved");
            expect(p1.data.resolvedAt).not.toBeNull();
          }

          // Menu: opsi diteruskan sebagai teks opsi
          h.store.insertPrompt({
            id: "m1",
            sessionId: sid,
            type: "menu",
            options: ["opA", "opB", "opC"],
            status: "pending",
            createdAt: 2,
            resolvedAt: null,
          });
          const r2 = h.sm.resolvePrompt(sid, "m1", { option });
          expect(r2.ok).toBe(true);
          expect(handle?.writes).toEqual([simpleResp === "approve" ? "y\n" : "n\n", `${option}\n`]);
          const p2 = h.store.getPrompt("m1");
          expect(p2.ok).toBe(true);
          if (p2.ok) {
            expect(p2.data.status).toBe("resolved");
            expect(p2.data.resolvedAt).not.toBeNull();
          }
        } finally {
          h.close();
        }
      },
    ),
    { numRuns: 100 },
  );
});

// Feature: kcg-bridge, Property 19: Respon tidak valid selalu ditolak tanpa efek samping
test("Property 19: prompt tak ada/resolved/opsi invalid -> ditolak tanpa efek samping", () => {
  fc.assert(
    fc.property(
      fc.string({ maxLength: 20 }),
      fc.constantFrom("opX", "not-in-menu", ""),
      (unknownId, badOption) => {
        const h = freshHarness();
        try {
          const res = h.sm.createSession({ agentType: "opencode", projectId: h.project.id });
          expect(res.ok).toBe(true);
          if (!res.ok) return;
          const sid = res.session.id;
          const handle = h.handles.get(sid);

          // promptId tidak ditemukan
          const r1 = h.sm.resolvePrompt(sid, unknownId, "approve");
          expect(r1.ok).toBe(false);

          // prompt sudah resolved
          h.store.insertPrompt({
            id: "r1",
            sessionId: sid,
            type: "confirmation",
            options: null,
            status: "pending",
            createdAt: 1,
            resolvedAt: null,
          });
          h.store.updatePromptStatus("r1", "resolved", 2);
          const r2 = h.sm.resolvePrompt(sid, "r1", "approve");
          expect(r2.ok).toBe(false);

          // opsi menu di luar daftar
          h.store.insertPrompt({
            id: "m1",
            sessionId: sid,
            type: "menu",
            options: ["a", "b"],
            status: "pending",
            createdAt: 2,
            resolvedAt: null,
          });
          const r3 = h.sm.resolvePrompt(sid, "m1", { option: badOption });
          expect(r3.ok).toBe(false);
          if (!r3.ok) expect(r3.error).toBe("INVALID_PROMPT_OPTION");

          // Tidak ada write & tidak ada perubahan status prompt
          expect(handle?.writes ?? []).toEqual([]);
          expect(h.store.listPendingPrompts(sid)).toHaveLength(1);
        } finally {
          h.close();
        }
      },
    ),
    { numRuns: 100 },
  );
});

// Feature: kcg-bridge, Property 20: Respon Cancel tidak meneruskan input
test("Property 20: cancel -> resolved tanpa write ke PtyHandle", () => {
  fc.assert(
    fc.property(fc.constantFrom("confirmation", "menu" as const), (type) => {
      const h = freshHarness();
      try {
        const res = h.sm.createSession({ agentType: "opencode", projectId: h.project.id });
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        const sid = res.session.id;
        const handle = h.handles.get(sid);

        h.store.insertPrompt({
          id: "z1",
          sessionId: sid,
          type,
          options: type === "menu" ? ["a"] : null,
          status: "pending",
          createdAt: 1,
          resolvedAt: null,
        });
        const r = h.sm.resolvePrompt(sid, "z1", "cancel");
        expect(r.ok).toBe(true);
        expect(handle?.writes ?? []).toEqual([]);
        const p = h.store.getPrompt("z1");
        expect(p.ok).toBe(true);
        if (p.ok) {
          expect(p.data.status).toBe("resolved");
          expect(p.data.resolvedAt).not.toBeNull();
        }
      } finally {
        h.close();
      }
    }),
    { numRuns: 100 },
  );
});

// Feature: kcg-bridge, Property 21: Free-text valid diteruskan utuh dengan newline
test("Property 21: free-text valid -> write(text + '\\n')", () => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 1, maxLength: 10000 }).filter((s) => s.trim().length > 0),
      (text) => {
        const h = freshHarness();
        try {
          const res = h.sm.createSession({ agentType: "opencode", projectId: h.project.id });
          expect(res.ok).toBe(true);
          if (!res.ok) return;
          const sid = res.session.id;
          const handle = h.handles.get(sid);

          const fwd = h.sm.sendFreeTextInput(sid, text);
          expect(fwd.ok).toBe(true);
          expect(handle?.writes).toEqual([`${text}\n`]);
        } finally {
          h.close();
        }
      },
    ),
    { numRuns: 100 },
  );
});

// Feature: kcg-bridge, Property 22: Free-text kosong atau melebihi batas selalu ditolak
test("Property 22: kosong/whitespace/panjang > 10000 -> ditolak tanpa write", () => {
  fc.assert(
    fc.property(
      fc.oneof(
        fc.string({ maxLength: 50 }).filter((s) => s.trim().length === 0),
        fc.string({ minLength: 10001, maxLength: 10010 }),
      ),
      (text) => {
        const h = freshHarness();
        try {
          const res = h.sm.createSession({ agentType: "opencode", projectId: h.project.id });
          expect(res.ok).toBe(true);
          if (!res.ok) return;
          const sid = res.session.id;
          const handle = h.handles.get(sid);

          const fwd = h.sm.sendFreeTextInput(sid, text);
          expect(fwd.ok).toBe(false);
          if (!fwd.ok) expect(fwd.error?.length ?? 0).toBeGreaterThan(0);
          expect(handle?.writes ?? []).toEqual([]);
        } finally {
          h.close();
        }
      },
    ),
    { numRuns: 100 },
  );
});

// Feature: kcg-bridge, Property 23: Free-text pada Session tidak aktif selalu ditolak
test("Property 23: stopped/crashed -> SESSION_NOT_ACTIVE tanpa write", () => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
      fc.constantFrom("stopped", "crashed" as const),
      (text, status) => {
        const h = freshHarness();
        try {
          const res = h.sm.createSession({ agentType: "opencode", projectId: h.project.id });
          expect(res.ok).toBe(true);
          if (!res.ok) return;
          const sid = res.session.id;
          const handle = h.handles.get(sid);

          if (status === "stopped") {
            handle?.kill("SIGTERM");
            handle?.emitExit(0);
          } else {
            handle?.emitExit(1);
          }
          expect(statusOf(h.store, sid)).toBe(status);

          const fwd = h.sm.sendFreeTextInput(sid, text);
          expect(fwd.ok).toBe(false);
          if (!fwd.ok) expect(fwd.error).toBe("SESSION_NOT_ACTIVE");
          expect(handle?.writes ?? []).toEqual([]);
        } finally {
          h.close();
        }
      },
    ),
    { numRuns: 100 },
  );
});

// Feature: kcg-bridge, Property 24: Free-text tidak mengubah status Interactive_Prompt
test("Property 24: free-text valid -> prompt pending tetap pending", () => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
      fc.array(fc.constantFrom("confirmation", "menu" as const), { maxLength: 5 }),
      (text, types) => {
        const h = freshHarness();
        try {
          const res = h.sm.createSession({ agentType: "opencode", projectId: h.project.id });
          expect(res.ok).toBe(true);
          if (!res.ok) return;
          const sid = res.session.id;
          types.forEach((t, i) => {
            h.store.insertPrompt({
              id: `pp-${i}`,
              sessionId: sid,
              type: t,
              options: t === "menu" ? ["a", "b"] : null,
              status: "pending",
              createdAt: i,
              resolvedAt: null,
            });
          });

          const fwd = h.sm.sendFreeTextInput(sid, text);
          expect(fwd.ok).toBe(true);
          expect(h.store.listPendingPrompts(sid)).toHaveLength(types.length);
        } finally {
          h.close();
        }
      },
    ),
    { numRuns: 100 },
  );
});
