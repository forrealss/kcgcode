/**
 * Unit test rekonsiliasi startup, agent hilang tak terduga, dan shutdown
 * (`sessions/startup-shutdown.ts`): Session `running` -> `crashed`.
 *
 * Mocking boundary: `AgentBackend` + `AgentClient` di-mock seluruhnya
 * (`fake-agent.ts`); `bun:sqlite` asli. Harness bersama ada di `harness.ts`.
 */
import { expect, test } from "bun:test";
import { createSession, freshHarness, statusOf } from "./harness";

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

test("shutdown biasa: session tetap running -> startup berikutnya crashed", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    await h.sm.shutdown();
    expect(statusOf(h.store, sid)).toBe("running");
    h.sm.reconcileOnStartup();
    expect(statusOf(h.store, sid)).toBe("crashed");
  } finally {
    h.close();
  }
});

test("shutdown stopRunning (restart karena update): session stopped, bukan crashed", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    await h.sm.shutdown({ stopRunning: true });
    expect(statusOf(h.store, sid)).toBe("stopped");
    expect(h.fake.released).toContain("p1");
    // Startup berikutnya tidak mengubahnya jadi crashed.
    h.sm.reconcileOnStartup();
    expect(statusOf(h.store, sid)).toBe("stopped");
  } finally {
    h.close();
  }
});
