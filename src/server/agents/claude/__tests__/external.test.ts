/**
 * Session Claude Code buatan Desktop / CLI lewat adapter (`client.external`)
 * dan penjaga dua penulis saat prompt: transcript yang masih dipegang proses
 * lain tidak di-`resume`.
 */
import { describe, expect, test } from "bun:test";
import type { SDKSessionInfo } from "@anthropic-ai/claude-agent-sdk";
import { fakeHostState, SID, setup, tick } from "./harness";

const OTHER = "22222222-2222-4222-8222-222222222222";

function info(sessionId: string, extra: Partial<SDKSessionInfo> = {}): SDKSessionInfo {
  return { sessionId, summary: "Fix flaky test", lastModified: 2000, ...extra };
}

describe("client.external", () => {
  test("list: judul Desktop didahulukan, tanda terbuka di tempat lain, terbaru dulu", async () => {
    const ext = fakeHostState();
    ext.infos = [
      info(SID, {
        lastModified: 1000,
        firstPrompt: "  please   fix\nthe test ",
        gitBranch: "main",
      }),
      info(OTHER, { lastModified: 3000, customTitle: "Renamed in CLI" }),
    ];
    ext.desktop.set(SID, { title: "Desktop title" });
    ext.running.set(OTHER, { pid: 42, entrypoint: "cli" });
    const { client } = setup([], undefined, ext);

    const res = await client.external?.list();
    expect(res?.ok).toBe(true);
    if (!res?.ok) return;
    expect(res.data).toEqual([
      {
        id: OTHER,
        title: "Renamed in CLI",
        updatedAt: 3000,
        openElsewhere: true,
        source: "cli",
      },
      {
        id: SID,
        title: "Desktop title",
        firstPrompt: "please fix the test",
        updatedAt: 1000,
        gitBranch: "main",
        openElsewhere: false,
        source: "claude-desktop",
      },
    ]);
  });

  test("history: transcript diterjemahkan; id tak dikenal -> SESSION_NOT_FOUND", async () => {
    const ext = fakeHostState();
    ext.infos = [info(SID, { createdAt: 500 })];
    ext.messages.set(SID, [
      {
        type: "user",
        uuid: "u1",
        session_id: SID,
        message: { role: "user", content: "hello" },
        parent_tool_use_id: null,
        parent_agent_id: null,
      },
    ]);
    const { client } = setup([], undefined, ext);
    const res = await client.external?.history(SID);
    expect(res).toEqual({
      ok: true,
      data: [
        { id: "usr_u1", role: "user", parts: [{ type: "text", text: "hello" }], createdAt: 500 },
      ],
    });
    expect(await client.external?.history(OTHER)).toEqual({
      ok: false,
      error: "SESSION_NOT_FOUND",
    });
  });

  test("fork -> id baru yang bisa di-resume", async () => {
    const ext = fakeHostState();
    const { client, calls } = setup([SID], undefined, ext);
    const res = await client.external?.fork(SID);
    expect(res).toEqual({ ok: true, data: { id: "fork-1" } });
    expect(ext.forks).toEqual([{ from: SID, id: "fork-1" }]);
    expect((await client.session.get("fork-1")).ok).toBe(true);
    await client.session.prompt({ sessionID: "fork-1", text: "go on" });
    await tick();
    expect(calls[0]?.options.resume).toBe("fork-1");
  });
});

describe("penjaga dua penulis", () => {
  test("transcript dipegang Claude Desktop -> prompt ditolak tanpa spawn; setelah ditutup -> resume", async () => {
    const ext = fakeHostState();
    ext.running.set(SID, { pid: 7, entrypoint: "claude-desktop" });
    const { client, calls } = setup([SID], undefined, ext);
    expect((await client.session.get(SID)).ok).toBe(true);

    const res = await client.session.prompt({ sessionID: SID, text: "hi" });
    expect(res.ok).toBe(false);
    expect(res.ok ? "" : res.error).toMatch(/^AGENT_PROMPT_FAILED: .*Claude Desktop/);
    expect(calls).toHaveLength(0);

    ext.running.clear();
    expect((await client.session.prompt({ sessionID: SID, text: "hi" })).ok).toBe(true);
    await tick();
    expect(calls[0]?.options.resume).toBe(SID);
  });

  test("Session baru (belum ada transcript) tidak dicek", async () => {
    const ext = fakeHostState();
    ext.running.set(SID, { pid: 7, entrypoint: "cli" });
    const { client, calls } = setup([], undefined, ext);
    expect((await client.session.prompt({ sessionID: SID, text: "hi" })).ok).toBe(true);
    await tick();
    expect(calls[0]?.options.sessionId).toBe(SID);
  });
});
