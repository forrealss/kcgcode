/**
 * Unit & property test lifecycle Session (`sessions/lifecycle.ts`):
 * `createSession` (validasi -> ensure client agent -> session.create),
 * `stopSession`, `resumeSession`, dan `deleteSession`.
 *
 * Mocking boundary: `AgentBackend` + `AgentClient` di-mock seluruhnya
 * (`fake-agent.ts`); `bun:sqlite` asli. Harness bersama ada di `harness.ts`.
 */
import { expect, test } from "bun:test";
import path from "node:path";
import fc from "fast-check";
import type { AgentType } from "../../../../types";
import { makeFakeClient } from "../../../__tests__/fake-agent";
import type { CreateSessionRequest } from "../../session-manager";
import {
  clientOf,
  createSession,
  flush,
  freshHarness,
  freshHarnessWithHooks,
  statusOf,
} from "./harness";

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
// stopSession
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
