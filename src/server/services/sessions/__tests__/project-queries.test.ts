/**
 * Unit test operasi tingkat Project (`sessions/project-queries.ts`):
 * daftar model/agent/MCP/skill dan kontrol MCP diteruskan ke client agent
 * Project.
 *
 * Mocking boundary: `AgentBackend` + `AgentClient` di-mock seluruhnya
 * (`fake-agent.ts`); `bun:sqlite` asli. Harness bersama ada di `harness.ts`.
 */
import { expect, test } from "bun:test";
import { clientOf, createSession, freshHarness } from "./harness";

test("listAgents -> daftar agent server headless", async () => {
  const h = freshHarness();
  try {
    await createSession(h); // pastikan server sudah di-ensure
    const res = await h.sm.listAgents("p1");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.map((a) => a.name)).toEqual(["build", "plan"]);
  } finally {
    h.close();
  }
});

test("listMcp / listSkills -> diteruskan ke server Project (skills menerima path Project)", async () => {
  const h = freshHarness();
  try {
    const mcp = await h.sm.listMcp("p1");
    expect(mcp.ok && mcp.data.map((m) => m.status)).toEqual(["connected", "failed"]);

    const skills = await h.sm.listSkills("p1");
    expect(skills.ok && skills.data[0]?.name).toBe("shadcn");
    expect(clientOf(h).calls).toContain("skill.list");

    expect((await h.sm.listMcp("nope")).ok).toBe(false);
    expect((await h.sm.listSkills("nope")).ok).toBe(false);
  } finally {
    h.close();
  }
});

test("setMcpEnabled / reconnectMcp -> diteruskan ke client agent Project", async () => {
  const h = freshHarness();
  try {
    expect(await h.sm.setMcpEnabled("p1", "broken", false)).toEqual({ ok: true });
    expect(await h.sm.reconnectMcp("p1", "context7")).toEqual({ ok: true });
    expect(clientOf(h).calls).toEqual(
      expect.arrayContaining(["mcp.setEnabled:broken:false", "mcp.reconnect:context7"]),
    );
    const mcp = await h.sm.listMcp("p1");
    expect(mcp.ok && mcp.data.map((m) => [m.name, m.status])).toEqual([
      ["context7", "connected"],
      ["broken", "disabled"],
    ]);

    // Kegagalan agent diteruskan apa adanya.
    clientOf(h).mcpActionResult = { ok: false, error: "AGENT_MCP_FAILED: spawn ENOENT" };
    expect(await h.sm.reconnectMcp("p1", "broken")).toEqual({
      ok: false,
      error: "AGENT_MCP_FAILED: spawn ENOENT",
    });

    expect(await h.sm.setMcpEnabled("p1", " ", true)).toEqual({
      ok: false,
      error: "INVALID_MCP_SERVER",
    });
    expect(await h.sm.reconnectMcp("nope", "x")).toEqual({
      ok: false,
      error: "PROJECT_NOT_FOUND",
    });
  } finally {
    h.close();
  }
});

test("listModels(projectId) -> daftar model dari server headless Project", async () => {
  const h = freshHarness();
  try {
    const res = await h.sm.listModels("p1");
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("listModels gagal");
    expect(res.data).toEqual([
      {
        providerID: "kcgcode",
        providerName: "kcgcode",
        modelID: "kiro/claude-opus-5",
        name: "Claude Opus 5",
      },
    ]);
    // Server di-ensure dengan path Project.
    expect(h.fake.ensureCalls).toContainEqual({ projectId: "p1", directory: h.project.path });

    const missing = await h.sm.listModels("project-tidak-ada");
    expect(missing.ok).toBe(false);
    if (missing.ok) throw new Error("harusnya gagal");
    expect(missing.error).toBe("PROJECT_NOT_FOUND");
  } finally {
    h.close();
  }
});
