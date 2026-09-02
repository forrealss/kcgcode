/**
 * Property & integration test `db.ts` (versi headless).
 * - Property 8: Round-trip pesan terstruktur (Requirements 3.1, 3.4)
 * - Property 9: Riwayat status append-only (Requirement 3.3)
 * - Property 10: Query Session tidak ditemukan (Requirement 3.5)
 * - Integration: kegagalan tulis & persistensi setelah restart (3.2, 3.6)
 * - Migrasi DB lama (kolom oc_session_id / kind / title + tabel messages)
 */
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import fc from "fast-check";
import { openSessionStore } from "../db";
import type { Session, SessionMessage, SessionStatus } from "../types";

function makeSession(id = "s1", status: SessionStatus = "running"): Session {
  return {
    id,
    projectId: "p1",
    agentType: "opencode",
    cwd: "/sandbox/proj",
    status,
    ocSessionId: id === "s1" ? "ses_1" : null,
    model: id === "s1" ? { providerID: "kcgrouter", modelID: "kiro/claude-opus-5" } : null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeMessage(id: string, role: "user" | "assistant" = "user"): SessionMessage {
  return {
    id,
    sessionId: "s1",
    role,
    parts: [{ type: "text", text: `isi-${id}` }],
    createdAt: 1,
  };
}

function seedProject(store: ReturnType<typeof openSessionStore>) {
  const res = store.insertProject({ id: "p1", name: "proj", path: "/sandbox/proj", createdAt: 1 });
  if (!res.ok) throw new Error(`seed project gagal: ${res.error}`);
}

function makeMemoryStore() {
  const store = openSessionStore(":memory:");
  seedProject(store);
  return store;
}

// Feature: kcg-bridge, Property 8: Round-trip penyimpanan pesan terstruktur
test("Property 8: round-trip messages — urutan identik dengan penyimpanan", () => {
  fc.assert(
    fc.property(
      fc.array(fc.constantFrom("user", "assistant" as const), { maxLength: 40 }),
      (roles) => {
        const store = makeMemoryStore();
        try {
          expect(store.insertSession(makeSession()).ok).toBe(true);
          roles.forEach((role, i) => {
            const r = store.insertMessage(makeMessage(`m${i}`, role));
            expect(r.ok).toBe(true);
          });

          const res = store.getMessages("s1");
          expect(res.ok).toBe(true);
          if (res.ok) {
            expect(res.data.map((m) => m.id)).toEqual(roles.map((_, i) => `m${i}`));
            expect(res.data.map((m) => m.role)).toEqual(roles);
          }
        } finally {
          store.close();
        }
      },
    ),
    { numRuns: 100 },
  );
});

// Feature: kcg-bridge, Property 9: Riwayat status bersifat append-only
test("Property 9: riwayat status append-only — jumlah baris tidak pernah berkurang", () => {
  fc.assert(
    fc.property(
      fc.array(fc.constantFrom("running", "stopped", "crashed" as const), { maxLength: 40 }),
      (statuses) => {
        const store = makeMemoryStore();
        try {
          expect(store.insertSession(makeSession()).ok).toBe(true);

          const seen: { status: SessionStatus; changedAt: number }[] = [];
          statuses.forEach((status, i) => {
            const changedAt = i + 1;
            expect(store.insertStatusHistory("s1", status, changedAt).ok).toBe(true);
            seen.push({ status, changedAt });

            const res = store.getStatusHistory("s1");
            expect(res.ok).toBe(true);
            if (res.ok) {
              expect(res.data.length).toBeGreaterThanOrEqual(seen.length);
              for (const prev of seen) {
                expect(res.data).toContainEqual({ sessionId: "s1", ...prev });
              }
            }
          });
        } finally {
          store.close();
        }
      },
    ),
    { numRuns: 100 },
  );
});

// Feature: kcg-bridge, Property 10: Query terhadap Session tidak ditemukan
test("Property 10: query Session tidak ditemukan -> not-found tanpa data", () => {
  fc.assert(
    fc.property(fc.string(), fc.string(), (sid1, sid2) => {
      const store = openSessionStore(":memory:");
      try {
        const out = store.getMessages(sid1);
        expect(out.ok).toBe(false);
        if (!out.ok) expect(out.error).toBe("SESSION_NOT_FOUND");

        const hist = store.getStatusHistory(sid2);
        expect(hist.ok).toBe(false);
        if (!hist.ok) expect(hist.error).toBe("SESSION_NOT_FOUND");
      } finally {
        store.close();
      }
    }),
    { numRuns: 100 },
  );
});

test("5.1: CRUD sessions — insert, update status, get, getByOcId, list", () => {
  const store = makeMemoryStore();
  expect(store.insertSession(makeSession()).ok).toBe(true);

  const listed = store.listSessions();
  expect(listed).toHaveLength(1);
  expect(listed[0]?.id).toBe("s1");
  expect(listed[0]?.ocSessionId).toBe("ses_1");

  const byOc = store.getSessionByOcId("ses_1");
  expect(byOc.ok).toBe(true);
  if (byOc.ok) expect(byOc.data.id).toBe("s1");
  expect(store.getSessionByOcId("nope").ok).toBe(false);

  const upd = store.updateSessionStatus("s1", "stopped", 99);
  expect(upd.ok).toBe(true);
  if (upd.ok) expect(upd.data.status).toBe("stopped");

  const got = store.getSession("s1");
  expect(got.ok).toBe(true);
  if (got.ok) expect(got.data.status).toBe("stopped");

  // updateSessionStatus juga mencatat ke riwayat (Requirement 3.3)
  const hist = store.getStatusHistory("s1");
  expect(hist.ok).toBe(true);
  if (hist.ok) expect(hist.data.map((h) => h.status)).toEqual(["stopped"]);
  store.close();
});

test("5.1: CRUD messages — insert, get, duplikat ditolak, not found session", () => {
  const store = makeMemoryStore();
  expect(store.insertSession(makeSession()).ok).toBe(true);

  expect(store.insertMessage(makeMessage("m1")).ok).toBe(true);
  // Duplikat message_id -> gagal (tidak menimpa).
  expect(store.insertMessage(makeMessage("m1")).ok).toBe(false);

  // Insert ke session tak dikenal -> ditolak.
  expect(
    store.insertMessage({ id: "mx", sessionId: "nope", role: "user", parts: [], createdAt: 1 }).ok,
  ).toBe(false);

  const res = store.getMessages("s1");
  expect(res.ok).toBe(true);
  if (res.ok) expect(res.data.map((m) => m.id)).toEqual(["m1"]);
  store.close();
});

test("5.1: CRUD prompts — kind/title ikut tersimpan; update status", () => {
  const store = makeMemoryStore();
  expect(store.insertSession(makeSession()).ok).toBe(true);

  const permission = {
    id: "pr1",
    sessionId: "s1",
    kind: "permission" as const,
    type: "confirmation" as const,
    title: "bash:ls",
    options: null,
    status: "pending" as const,
    createdAt: 1,
    resolvedAt: null,
  };
  expect(store.insertPrompt(permission).ok).toBe(true);

  const question = {
    id: "que1",
    sessionId: "s1",
    kind: "question" as const,
    type: "menu" as const,
    title: "Pilih mode",
    options: ["Build", "Plan"],
    status: "pending" as const,
    createdAt: 2,
    resolvedAt: null,
  };
  expect(store.insertPrompt(question).ok).toBe(true);

  const pending = store.listPendingPrompts("s1");
  expect(pending).toHaveLength(2);

  const upd = store.updatePromptStatus("pr1", "resolved", 5);
  expect(upd.ok).toBe(true);
  if (upd.ok) expect(upd.data.status).toBe("resolved");
  expect(store.listPendingPrompts("s1")).toHaveLength(1);

  const got = store.getPrompt("que1");
  expect(got.ok).toBe(true);
  if (got.ok) {
    expect(got.data.kind).toBe("question");
    expect(got.data.title).toBe("Pilih mode");
    expect(got.data.options).toEqual(["Build", "Plan"]);
  }
  expect(store.getPrompt("nope").ok).toBe(false);
  store.close();
});

test("5.1: CRUD projects — insert, get by name/path, list", () => {
  const store = makeMemoryStore();
  const proj = { id: "p2", name: "proj2", path: "/sandbox/proj2", createdAt: 2 };
  expect(store.insertProject(proj).ok).toBe(true);

  const byName = store.getProjectByName("proj2");
  expect(byName.ok).toBe(true);
  if (byName.ok) expect(byName.data.path).toBe("/sandbox/proj2");

  expect(store.getProjectByPath("/sandbox/proj2").ok).toBe(true);
  expect(store.listProjects()).toHaveLength(2);
  store.close();
});

test("migrasi: DB lama (skema PTY) dibuka dengan store baru -> kolom & tabel ditambah", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kcg-mig-"));
  const dbPath = path.join(dir, "legacy.sqlite");

  // Simulasikan DB lama: skema versi PTY (tanpa oc_session_id, kind, title, messages).
  writeFileSync(dbPath, "");
  const { Database } = require("bun:sqlite") as typeof import("bun:sqlite");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, path TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, agent_type TEXT NOT NULL, cwd TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE session_status_history (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, status TEXT NOT NULL, changed_at INTEGER NOT NULL);
    CREATE TABLE output_stream (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, seq INTEGER NOT NULL, chunk TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE prompts (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL, options_json TEXT, status TEXT NOT NULL, created_at INTEGER NOT NULL, resolved_at INTEGER);
    INSERT INTO projects (id, name, path, created_at) VALUES ('p1', 'old', '/sandbox/old', 1);
    INSERT INTO sessions (id, project_id, agent_type, cwd, status, created_at, updated_at) VALUES ('s1', 'p1', 'opencode', '/sandbox/old', 'running', 1, 1);
    INSERT INTO output_stream (session_id, seq, chunk, created_at) VALUES ('s1', 1, 'old chunk', 1);
  `);
  db.close();

  // Buka dengan store baru: migrasi menambah kolom + tabel messages.
  const store = openSessionStore(dbPath);
  const sess = store.getSession("s1");
  expect(sess.ok).toBe(true);
  if (sess.ok) expect(sess.data.ocSessionId).toBeNull();

  // Data lama output_stream tetap utuh (tidak dihapus migrasi).
  const legacy = dbExec(dbPath, "SELECT chunk FROM output_stream WHERE session_id='s1'");
  expect(legacy).toEqual([{ chunk: "old chunk" }]);

  // Tabel & kolom baru bisa dipakai.
  expect(store.insertSession(makeSession("s2")).ok).toBe(true);
  expect(store.insertMessage(makeMessage("m1")).ok).toBe(true);
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function dbExec(dbPath: string, sql: string): Record<string, unknown>[] {
  const { Database } = require("bun:sqlite") as typeof import("bun:sqlite");
  const db = new Database(dbPath);
  try {
    return db.query(sql).all() as Record<string, unknown>[];
  } finally {
    db.close();
  }
}

// ---- Integration: kegagalan tulis & persistensi setelah restart ----
test("4.4: kegagalan tulis tidak menghapus data lama (simulasi db tertutup)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kcg-db2-"));
  const dbPath = path.join(dir, "kcg.sqlite");

  const store = openSessionStore(dbPath);
  seedProject(store);
  expect(store.insertSession(makeSession()).ok).toBe(true);
  expect(store.insertMessage(makeMessage("m1")).ok).toBe(true);
  expect(store.insertMessage(makeMessage("m2", "assistant")).ok).toBe(true);
  expect(store.insertStatusHistory("s1", "running", 1).ok).toBe(true);

  // Simulasi kegagalan tulis: tutup koneksi lalu coba tulis lagi.
  store.close();
  const failed = store.insertMessage(makeMessage("m3"));
  expect(failed.ok).toBe(false);

  // Data lama tetap utuh setelah dibuka ulang (Requirement 3.6).
  const store2 = openSessionStore(dbPath);
  const messages = store2.getMessages("s1");
  expect(messages.ok).toBe(true);
  if (messages.ok) expect(messages.data.map((m) => m.id)).toEqual(["m1", "m2"]);
  const hist = store2.getStatusHistory("s1");
  expect(hist.ok).toBe(true);
  if (hist.ok) expect(hist.data.map((h) => h.status)).toEqual(["running"]);
  store2.close();
  rmSync(dir, { recursive: true, force: true });
});

test("4.4: persistensi setelah restart server (file sqlite yang sama)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kcg-db2-"));
  const dbPath = path.join(dir, "kcg.sqlite");

  const store1 = openSessionStore(dbPath);
  seedProject(store1);
  expect(store1.insertSession(makeSession()).ok).toBe(true);
  store1.insertMessage(makeMessage("m1"));
  store1.insertMessage(makeMessage("m2", "assistant"));
  store1.insertStatusHistory("s1", "running", 1);
  store1.insertStatusHistory("s1", "crashed", 2);
  store1.close();

  const store2 = openSessionStore(dbPath);
  const messages = store2.getMessages("s1");
  expect(messages.ok).toBe(true);
  if (messages.ok) expect(messages.data.map((m) => m.id)).toEqual(["m1", "m2"]);
  const hist = store2.getStatusHistory("s1");
  expect(hist.ok).toBe(true);
  if (hist.ok) expect(hist.data.map((h) => h.status)).toEqual(["running", "crashed"]);
  store2.close();
  rmSync(dir, { recursive: true, force: true });
});
