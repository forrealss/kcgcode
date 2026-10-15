/**
 * Unit test client agent per (tipe CLI_Agent, Project)
 * (`sessions/agent-clients.ts`): tiap tipe agent memakai backend-nya
 * sendiri tanpa menyentuh backend lain.
 *
 * Mocking boundary: `AgentBackend` + `AgentClient` di-mock seluruhnya
 * (`fake-agent.ts`); `bun:sqlite` asli. Harness bersama ada di `harness.ts`.
 */
import { expect, test } from "bun:test";
import { createSession, ev, flush, freshHarnessWithHooks, makeFakeServers } from "./harness";

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
