/**
 * Katalog per Project opencode (`catalog.ts`) dengan API palsu: daftar
 * model/agent/MCP/skill/file/vcs dan kontrol MCP.
 */
import { describe, expect, test } from "bun:test";
import { PROJ, setup } from "./harness";

describe("createOpencodeBackend", () => {
  test("daftar model/agent/MCP/skill/file/vcs dipetakan ke tipe tampilan", async () => {
    const { backend } = setup();
    const r = await backend.ensure("p1", PROJ);
    if (!r.ok) throw new Error("ensure");
    const c = r.data;
    expect(await c.model.list()).toEqual({
      ok: true,
      data: [
        {
          providerID: "opencode",
          providerName: "OpenCode",
          modelID: "big-pickle",
          name: "Big Pickle",
          // Variant model = tingkat thinking effort; model default ditandai.
          efforts: ["low", "high"],
          isDefault: true,
        },
        {
          providerID: "opencode",
          providerName: "OpenCode",
          modelID: "small",
          name: "Small",
        },
      ],
    });
    expect(await c.agent.list()).toEqual({
      ok: true,
      data: [{ name: "build", mode: "primary", description: "Default" }],
    });
    expect(await c.mcp.list()).toEqual({
      ok: true,
      data: [
        { name: "a", status: "connected", error: null },
        { name: "p", status: "pending", error: null },
        { name: "z", status: "failed", error: "boom" },
      ],
    });
    const skills = await c.skill.list();
    expect(skills.ok && skills.data.map((s) => [s.name, s.source, s.location === null])).toEqual([
      ["global", "global", false],
      ["local", "project", false],
      ["opencode", "builtin", true],
    ]);
    expect(await c.file.find("a")).toEqual({ ok: true, data: ["src/a.ts"] });
    expect(await c.vcs.status()).toEqual({
      ok: true,
      data: [{ path: "src/a.ts", added: 3, removed: 1, status: "modified" }],
    });
  });

  test("MCP: aktif/reconnect = connect, nonaktif = disconnect; gagal -> AGENT_MCP_FAILED", async () => {
    const { backend, apis } = setup();
    const r = await backend.ensure("p1", PROJ);
    if (!r.ok) throw new Error("ensure");
    const c = r.data;
    expect(await c.mcp.setEnabled("ctx", false)).toEqual({ ok: true });
    expect(await c.mcp.setEnabled("ctx", true)).toEqual({ ok: true });
    expect(await c.mcp.reconnect("ctx")).toEqual({ ok: true });
    const input = { location: { directory: PROJ }, server: "ctx" };
    expect(apis[0]?.calls.filter(([n]) => n.startsWith("mcp.") && n !== "mcp.list")).toEqual([
      ["mcp.disconnect", input],
      ["mcp.connect", input],
      ["mcp.connect", input],
    ]);
    apis[0]?.errors.set("mcp.connect", new Error("spawn ENOENT"));
    expect(await c.mcp.reconnect("ctx")).toEqual({
      ok: false,
      error: "AGENT_MCP_FAILED: spawn ENOENT",
    });
  });

  test("MCP kcgcode: mcp.add di memori service per direktori, dicabut saat release", async () => {
    const { backend, apis } = setup();
    const r = await backend.ensure("p1", PROJ);
    if (!r.ok) throw new Error("ensure");
    const server = {
      url: "http://127.0.0.1:3000/mcp/preview?project=p1",
      headers: { Authorization: "Bearer t" },
    };
    expect(await r.data.mcp.register?.("kcg_preview", server)).toEqual({ ok: true });
    expect(apis[0]?.calls.filter(([n]) => n === "mcp.add")).toEqual([
      [
        "mcp.add",
        {
          location: { directory: PROJ },
          server: "kcg_preview",
          config: { type: "remote", ...server },
        },
      ],
    ]);
    await backend.release("p1");
    expect(apis[0]?.calls.filter(([n]) => n === "mcp.remove")).toEqual([
      ["mcp.remove", { location: { directory: PROJ }, server: "kcg_preview" }],
    ]);
  });
});
