/**
 * Katalog per Project Claude Code (`catalog.ts`): slash command, MCP, dan
 * skill — lewat proses yang hidup atau query sementara.
 */
import { describe, expect, test } from "bun:test";
import { slashCommandInfo } from "../catalog";
import { SID, setup, tick } from "./harness";

describe("slash command Claude Code", () => {
  test("supportedCommands -> daftar composer; bawaan yang bentrok dengan KCG disembunyikan", async () => {
    const { client, calls } = setup();
    const res = await client.command.list();
    expect(res).toEqual({
      ok: true,
      data: [
        { name: "review", description: "Review changes", argumentHint: "[pr#]", builtin: true },
        {
          name: "remotion:docs",
          description: "(Remotion) Search docs",
          argumentHint: null,
          aliases: ["docs"],
        },
        { name: "model", description: "Project command", argumentHint: "<name>" },
      ],
    });
    // Query sementara, lalu cache: panggilan kedua tanpa proses baru.
    expect(calls[0]?.query.closed).toBe(true);
    await client.command.list();
    expect(calls.length).toBe(1);
  });

  test("commands_changed dari CLI mengganti cache; reload membuangnya", async () => {
    const { client, calls } = setup();
    await client.session.prompt({ sessionID: SID, text: "/review 12" });
    await tick();
    // Teks slash command diteruskan apa adanya — CLI yang menjalankannya.
    expect(calls[0]?.inputs[0]?.message).toEqual({ role: "user", content: "/review 12" });
    calls[0]?.query.push({
      type: "system",
      subtype: "commands_changed",
      commands: [{ name: "fresh", description: "", argumentHint: "" }],
    });
    await tick();
    expect(await client.command.list()).toEqual({
      ok: true,
      data: [{ name: "fresh", description: null, argumentHint: null }],
    });
    await client.location.reload();
    const again = await client.command.list();
    expect(again.ok && again.data.map((c) => c.name)).toContain("review");
  });

  test("slashCommandInfo: nama internal `__` selalu disembunyikan", () => {
    expect(slashCommandInfo({ name: "__x", description: "", argumentHint: "" })).toBeNull();
    expect(
      slashCommandInfo({ name: "focus", description: "", argumentHint: "", builtin: true }),
    ).toBeNull();
  });
});

describe("MCP & skill Claude Code", () => {
  const SID2 = "22222222-2222-4222-8222-222222222222";

  test("tanpa proses: toggle lewat query sementara; hanya status server itu yang disimpan", async () => {
    const { client, calls } = setup(
      [],
      [
        { name: "fs", status: "connected" },
        // Masih menyambung saat proses sementara ditutup — jangan disimpan.
        { name: "slow", status: "pending" },
      ],
    );
    expect(await client.mcp.setEnabled("fs", false)).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.options.persistSession).toBe(false);
    expect(calls[0]?.query.controls).toEqual(["toggle:fs:false"]);
    expect(calls[0]?.query.closed).toBe(true);
    expect(await client.mcp.list()).toEqual({
      ok: true,
      data: [{ name: "fs", status: "disabled", error: null }],
    });
  });

  test("toggle & reconnect dikirim ke SEMUA proses yang hidup, tanpa query sementara", async () => {
    const { client, calls } = setup();
    await client.session.prompt({ sessionID: SID, text: "a" });
    await client.session.prompt({ sessionID: SID2, text: "b" });
    await tick();
    expect(await client.mcp.setEnabled("fs", true)).toEqual({ ok: true });
    expect(await client.mcp.reconnect("fs")).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    for (const c of calls) expect(c.query.controls).toEqual(["toggle:fs:true", "reconnect:fs"]);
  });

  test("gagal di satu proses -> CC_MCP_FAILED, proses lain tetap menerima request", async () => {
    const { client, calls } = setup();
    await client.session.prompt({ sessionID: SID, text: "a" });
    await client.session.prompt({ sessionID: SID2, text: "b" });
    await tick();
    const first = calls[0]?.query;
    if (first) first.mcpError = new Error('Executable not found in $PATH: "npx"');
    expect(await client.mcp.reconnect("fs")).toEqual({
      ok: false,
      error: 'CC_MCP_FAILED: Executable not found in $PATH: "npx"',
    });
    expect(calls[1]?.query.controls).toEqual(["reconnect:fs"]);
  });

  test("status `pending` (sedang menyambung) diteruskan", async () => {
    const { client, calls } = setup();
    await client.session.prompt({ sessionID: SID, text: "a" });
    await tick();
    const q = calls[0]?.query;
    if (q) q.mcp = [{ name: "slow", status: "pending" }];
    expect(await client.mcp.list()).toEqual({
      ok: true,
      data: [{ name: "slow", status: "pending", error: null }],
    });
  });

  test("reload: reloadSkills di proses yang hidup (tanpa restart); tanpa proses tidak spawn", async () => {
    const { client, calls } = setup();
    expect(await client.location.reload()).toEqual({ ok: true });
    expect(calls).toHaveLength(0);

    await client.session.prompt({ sessionID: SID, text: "a" });
    await tick();
    const q = calls[0]?.query;
    expect(await client.location.reload()).toEqual({ ok: true });
    expect(q?.controls).toEqual(["reloadSkills"]);
    expect(q?.closed).toBe(false);
    expect(calls).toHaveLength(1);
  });
});
