/**
 * Impor Session agent buatan Claude Desktop / CLI (`sessions/external-sessions.ts`):
 * daftar kandidat, impor beserta riwayat, penjaga Session yang masih terbuka
 * di aplikasi lain (fork), dan prompt lanjutan ke Session agent yang sama.
 *
 * Mocking boundary: `AgentBackend` + `AgentClient` (dengan `external`) palsu;
 * `bun:sqlite` asli.
 */
import { expect, test } from "bun:test";
import type { ExternalSession } from "../../../../types";
import {
  type FakeAgentClient,
  makeFakeBackend,
  makeFakeClient,
} from "../../../__tests__/fake-agent";
import type { AgentHistoryMessage } from "../../../agents/types";
import type { Result } from "../../../result";
import { flush, freshHarnessWithHooks } from "./harness";

const EXT: ExternalSession = {
  id: "cc-1",
  title: "Fix flaky test",
  updatedAt: 500,
  openElsewhere: false,
  source: "claude-desktop",
};

const HISTORY: AgentHistoryMessage[] = [
  { id: "usr_u1", role: "user", parts: [{ type: "text", text: "fix it" }], createdAt: 10 },
  {
    id: "msg_u2",
    role: "assistant",
    parts: [{ id: "prt_msg_u2_text_0", type: "text", text: "Done." }],
    createdAt: 20,
  },
];

function externalHarness(sessions: ExternalSession[] = [EXT]) {
  const state = {
    sessions,
    history: { ok: true, data: HISTORY } as Result<AgentHistoryMessage[]>,
    forks: [] as string[],
  };
  let client: FakeAgentClient | undefined;
  const claude = makeFakeBackend("claude-code", () => {
    client = makeFakeClient();
    client.external = {
      list: async () => ({ ok: true, data: state.sessions }),
      history: async () => state.history,
      async fork(id) {
        state.forks.push(id);
        return { ok: true, data: { id: `${id}-fork` } };
      },
    };
    return client;
  });
  const h = freshHarnessWithHooks({}, {}, { backends: { "claude-code": claude.backend } });
  return {
    h,
    state,
    client: () => {
      if (!client) throw new Error("client claude belum dibuat");
      return client;
    },
  };
}

test("impor -> Session running menunjuk Session agent yang sama, riwayat tersalin", async () => {
  const { h, client } = externalHarness();
  try {
    const listed = await h.sm.listExternalSessions("p1", "claude-code");
    expect(listed).toEqual({ ok: true, data: [EXT] });

    const res = await h.sm.importExternalSession({
      projectId: "p1",
      agentType: "claude-code",
      externalId: "cc-1",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.session).toMatchObject({
      projectId: "p1",
      agentType: "claude-code",
      status: "running",
      ocSessionId: "cc-1",
      title: "Fix flaky test",
      cwd: h.project.path,
    });
    expect(client().calls).toContain("session.get:cc-1");
    const msgs = h.store.getMessages(res.session.id);
    expect(msgs.ok && msgs.data).toEqual(HISTORY.map((m) => ({ ...m, sessionId: res.session.id })));

    // Sudah diimpor -> tidak ditawarkan lagi; impor ulang = Session yang sama.
    expect(await h.sm.listExternalSessions("p1", "claude-code")).toEqual({ ok: true, data: [] });
    const again = await h.sm.importExternalSession({
      projectId: "p1",
      agentType: "claude-code",
      externalId: "cc-1",
    });
    expect(again.ok && again.session.id).toBe(res.session.id);
    expect(h.store.listSessions()).toHaveLength(1);

    // Pesan berikutnya dikirim ke Session agent yang sama (resume).
    expect((await h.sm.sendFreeTextInput(res.session.id, "continue")).ok).toBe(true);
    await flush();
    expect(client().calls).toContain("session.prompt:continue");
  } finally {
    h.close();
  }
});

test("masih terbuka di aplikasi lain: ditolak tanpa fork; fork -> lanjut di salinan", async () => {
  const { h, state } = externalHarness([{ ...EXT, openElsewhere: true }]);
  try {
    const req = { projectId: "p1", agentType: "claude-code" as const, externalId: "cc-1" };
    expect(await h.sm.importExternalSession(req)).toEqual({
      ok: false,
      error: "EXTERNAL_SESSION_OPEN",
    });
    expect(h.store.listSessions()).toHaveLength(0);
    expect(state.forks).toEqual([]);

    const res = await h.sm.importExternalSession({ ...req, fork: true });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(state.forks).toEqual(["cc-1"]);
    expect(res.session.ocSessionId).toBe("cc-1-fork");
    const msgs = h.store.getMessages(res.session.id);
    expect(msgs.ok && msgs.data.length).toBe(HISTORY.length);
  } finally {
    h.close();
  }
});

test("gagal: riwayat tak terbaca, id tak dikenal, agent tanpa dukungan impor", async () => {
  const { h, state } = externalHarness();
  try {
    state.history = { ok: false, error: "CC_EXTERNAL_HISTORY_FAILED: boom" };
    const req = { projectId: "p1", agentType: "claude-code" as const, externalId: "cc-1" };
    expect(await h.sm.importExternalSession(req)).toEqual({
      ok: false,
      error: "CC_EXTERNAL_HISTORY_FAILED: boom",
    });
    expect(h.store.listSessions()).toHaveLength(0);

    expect(await h.sm.importExternalSession({ ...req, externalId: "nope" })).toEqual({
      ok: false,
      error: "SESSION_NOT_FOUND",
    });
    // Client opencode palsu tidak punya `external`.
    expect(await h.sm.listExternalSessions("p1", "opencode")).toEqual({
      ok: false,
      error: "EXTERNAL_SESSIONS_UNSUPPORTED",
    });
  } finally {
    h.close();
  }
});
