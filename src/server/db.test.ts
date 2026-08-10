/**
 * Property & integration test `db.ts` (task 4.2, 4.3, 4.4, 5.1).
 * - Property 8: Round-trip Output_Stream (Requirements 3.1, 3.4)
 * - Property 9: Riwayat status append-only (Requirement 3.3)
 * - Property 10: Query Session tidak ditemukan (Requirement 3.5)
 * - Integration 4.4: kegagalan tulis & persistensi setelah restart (3.2, 3.6)
 */
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import fc from "fast-check";
import { openSessionStore } from "./db";
import type { Session, SessionStatus } from "./types";

function makeSession(id = "s1", status: SessionStatus = "running"): Session {
  return {
    id,
    projectId: "p1",
    agentType: "opencode",
    cwd: "/sandbox/proj",
    status,
    createdAt: 1,
    updatedAt: 1,
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

// Feature: kcg-bridge, Property 8: Round-trip penyimpanan Output_Stream
test("Property 8: Round-trip Output_Stream — urutan identik dengan penyimpanan", () => {
  fc.assert(
    fc.property(fc.array(fc.string({ maxLength: 200 }), { maxLength: 50 }), (chunks) => {
      const store = makeMemoryStore();
      try {
        const ins = store.insertSession(makeSession());
        expect(ins.ok).toBe(true);

        chunks.forEach((data, i) => {
          const r = store.insertOutputChunk({ sessionId: "s1", seq: i + 1, data, ts: i + 1 });
          expect(r.ok).toBe(true);
        });

        const res = store.getOutputChunks("s1");
        expect(res.ok).toBe(true);
        if (res.ok) {
          expect(res.data.map((c) => c.seq)).toEqual(chunks.map((_, i) => i + 1));
          expect(res.data.map((c) => c.data)).toEqual(chunks);
        }
      } finally {
        store.close();
      }
    }),
    { numRuns: 100 },
  );
});

// Feature: kcg-bridge, Property 9: Riwayat status bersifat append-only
test("Property 9: Riwayat status append-only — jumlah baris tidak pernah berkurang", () => {
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
            const r = store.insertStatusHistory("s1", status, changedAt);
            expect(r.ok).toBe(true);
            seen.push({ status, changedAt });

            const res = store.getStatusHistory("s1");
            expect(res.ok).toBe(true);
            if (res.ok) {
              // Jumlah baris tidak pernah berkurang & seluruh baris lama tetap terbaca
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
test("Property 10: Query Session tidak ditemukan -> indikasi not-found tanpa data", () => {
  fc.assert(
    fc.property(fc.string(), fc.string(), (sid1, sid2) => {
      const store = openSessionStore(":memory:");
      try {
        // Tidak ada session yang dibuat: seluruh id pasti "tidak ditemukan".
        const out = store.getOutputChunks(sid1);
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

test("5.1: CRUD sessions — insert, update status, get, list", () => {
  const store = makeMemoryStore();
  expect(store.insertSession(makeSession()).ok).toBe(true);

  const listed = store.listSessions();
  expect(listed).toHaveLength(1);
  expect(listed[0]?.id).toBe("s1");

  const upd = store.updateSessionStatus("s1", "stopped", 99);
  expect(upd.ok).toBe(true);
  if (upd.ok) expect(upd.data.status).toBe("stopped");

  const got = store.getSession("s1");
  expect(got.ok).toBe(true);
  if (got.ok) expect(got.data.status).toBe("stopped");

  // updateSessionStatus juga mencatat ke riwayat (Requirement 3.3)
  const hist = store.getStatusHistory("s1");
  expect(hist.ok).toBe(true);
  if (hist.ok) {
    expect(hist.data.map((h) => h.status)).toEqual(["stopped"]);
  }
  store.close();
});

test("5.1: CRUD projects — insert, get by name/path, list", () => {
  const store = makeMemoryStore();
  const proj = { id: "p2", name: "proj2", path: "/sandbox/proj2", createdAt: 2 };
  expect(store.insertProject(proj).ok).toBe(true);

  const byName = store.getProjectByName("proj2");
  expect(byName.ok).toBe(true);
  if (byName.ok) expect(byName.data.path).toBe("/sandbox/proj2");

  const byPath = store.getProjectByPath("/sandbox/proj2");
  expect(byPath.ok).toBe(true);

  const list = store.listProjects();
  expect(list).toHaveLength(2);
  expect(store.getProjectById("p2").ok).toBe(true);
  expect(store.getProjectByName("proj2").ok).toBe(true);
  store.close();
});

test("5.1: CRUD prompts — insert, get, list pending, update status", () => {
  const store = makeMemoryStore();
  expect(store.insertSession(makeSession()).ok).toBe(true);

  const prompt = {
    id: "pr1",
    sessionId: "s1",
    type: "confirmation" as const,
    options: null,
    status: "pending" as const,
    createdAt: 1,
    resolvedAt: null,
  };
  expect(store.insertPrompt(prompt).ok).toBe(true);

  const pending = store.listPendingPrompts("s1");
  expect(pending).toHaveLength(1);

  const upd = store.updatePromptStatus("pr1", "resolved", 5);
  expect(upd.ok).toBe(true);
  if (upd.ok) expect(upd.data.status).toBe("resolved");

  expect(store.listPendingPrompts("s1")).toHaveLength(0);
  expect(store.getPrompt("pr1").ok).toBe(true);
  expect(store.getPrompt("nope").ok).toBe(false);
  store.close();
});

// ---- Task 4.4: integration test kegagalan tulis & persistensi setelah restart ----
test("4.4: kegagalan tulis tidak menghapus data lama (simulasi db tertutup/disk penuh)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kcg-db-"));
  const dbPath = path.join(dir, "kcg.sqlite");

  const store = openSessionStore(dbPath);
  seedProject(store);
  expect(store.insertSession(makeSession()).ok).toBe(true);
  expect(store.insertOutputChunk({ sessionId: "s1", seq: 1, data: "a", ts: 1 }).ok).toBe(true);
  expect(store.insertOutputChunk({ sessionId: "s1", seq: 2, data: "b", ts: 2 }).ok).toBe(true);
  expect(store.insertStatusHistory("s1", "running", 1).ok).toBe(true);

  // Simulasi kegagalan tulis: tutup koneksi lalu coba tulis lagi.
  store.close();
  const failed = store.insertOutputChunk({ sessionId: "s1", seq: 3, data: "c", ts: 3 });
  expect(failed.ok).toBe(false);

  // Data lama tetap utuh setelah dibuka ulang (Requirement 3.6).
  const store2 = openSessionStore(dbPath);
  const chunks = store2.getOutputChunks("s1");
  expect(chunks.ok).toBe(true);
  if (chunks.ok) {
    expect(chunks.data.map((c) => c.data)).toEqual(["a", "b"]);
    expect(chunks.data.map((c) => c.seq)).toEqual([1, 2]);
  }
  const hist = store2.getStatusHistory("s1");
  expect(hist.ok).toBe(true);
  if (hist.ok) {
    expect(hist.data.map((h) => h.status)).toEqual(["running"]);
  }
  store2.close();
  rmSync(dir, { recursive: true, force: true });
});

test("4.4: persistensi setelah restart server (file sqlite yang sama)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kcg-db-"));
  const dbPath = path.join(dir, "kcg.sqlite");

  // "Restart" = buka koneksi baru pada file yang sama.
  const store1 = openSessionStore(dbPath);
  seedProject(store1);
  expect(store1.insertSession(makeSession()).ok).toBe(true);
  store1.insertOutputChunk({ sessionId: "s1", seq: 1, data: "x", ts: 1 });
  store1.insertOutputChunk({ sessionId: "s1", seq: 2, data: "y", ts: 2 });
  store1.insertStatusHistory("s1", "running", 1);
  store1.insertStatusHistory("s1", "crashed", 2);
  store1.close();

  const store2 = openSessionStore(dbPath);
  const chunks = store2.getOutputChunks("s1");
  expect(chunks.ok).toBe(true);
  if (chunks.ok) {
    expect(chunks.data.map((c) => c.data)).toEqual(["x", "y"]);
  }
  const hist = store2.getStatusHistory("s1");
  expect(hist.ok).toBe(true);
  if (hist.ok) {
    expect(hist.data.map((h) => h.status)).toEqual(["running", "crashed"]);
  }
  store2.close();
  rmSync(dir, { recursive: true, force: true });
});
