/**
 * Sinkron pilihan Session ke proses `claude` (`processes.ts`): thinking
 * effort dan permission mode, saat spawn maupun pada proses yang hidup.
 */
import { describe, expect, test } from "bun:test";
import { CLAUDE_PROVIDER_ID } from "../constants";
import { data, SID, setup, state, tick } from "./harness";

describe("thinking effort Claude Code", () => {
  const sonnet = { providerID: CLAUDE_PROVIDER_ID, modelID: "sonnet" };

  test("effort baru: spawn dengan opsi effort; tingkat tak dikenal diabaikan", async () => {
    const { client, calls } = setup();
    await client.session.switchModel(SID, sonnet, "xhigh");
    await client.session.prompt({ sessionID: SID, text: "a" });
    await tick();
    expect(calls[0]?.options.model).toBe("sonnet");
    expect(calls[0]?.options.effort).toBe("xhigh");

    const other = "22222222-2222-4222-8222-222222222222";
    await client.session.switchModel(other, null, "ultra");
    await client.session.prompt({ sessionID: other, text: "b" });
    await tick();
    expect(calls[1]?.options.effort).toBeUndefined();
  });

  test("ganti effort pada proses hidup -> applyFlagSettings; sama tidak dikirim ulang", async () => {
    const { client, calls } = setup();
    await client.session.prompt({ sessionID: SID, text: "a" });
    await tick();
    const q = calls[0]?.query;
    q?.push(state("idle"));
    await tick();

    await client.session.switchModel(SID, sonnet, "low");
    await client.session.prompt({ sessionID: SID, text: "b" });
    await client.session.switchModel(SID, sonnet, "low");
    await client.session.prompt({ sessionID: SID, text: "c" });
    expect(calls.length).toBe(1);
    expect(q?.models).toEqual(["sonnet"]);
    expect(q?.efforts).toEqual(["low"]);
  });

  test("kembali ke effort default -> proses diganti (resume) agar settings user berlaku", async () => {
    const { client, calls } = setup();
    await client.session.switchModel(SID, null, "max");
    await client.session.prompt({ sessionID: SID, text: "a" });
    await tick();
    const q = calls[0]?.query;
    q?.push({ type: "system", subtype: "init", permissionMode: "default" });
    q?.push(state("running"));
    q?.push(state("idle"));
    await tick();

    await client.session.switchModel(SID, null, null);
    await client.session.prompt({ sessionID: SID, text: "b" });
    await tick();
    expect(q?.closed).toBe(true);
    expect(calls.length).toBe(2);
    expect(calls[1]?.options.resume).toBe(SID);
    expect(calls[1]?.options.effort).toBeUndefined();
  });

  test("reset effort di tengah turn -> flag settings di-reset tanpa mengganti proses", async () => {
    const { client, calls } = setup();
    await client.session.switchModel(SID, null, "high");
    await client.session.prompt({ sessionID: SID, text: "a" });
    await tick();
    const q = calls[0]?.query;
    q?.push(state("running"));
    await tick();

    await client.session.switchModel(SID, null, null);
    await client.session.prompt({ sessionID: SID, text: "b" });
    expect(calls.length).toBe(1);
    expect(q?.efforts).toEqual([null]);
  });
});

describe("permission mode Claude Code", () => {
  test("mode baru: spawn dengan permissionMode; mode tak dikenal ditolak", async () => {
    const { client, calls } = setup();
    expect(await client.session.setPermissionMode(SID, "yolo")).toEqual({
      ok: false,
      error: "INVALID_PERMISSION_MODE",
    });
    expect((await client.session.setPermissionMode(SID, "acceptEdits")).ok).toBe(true);
    expect(calls.length).toBe(0); // tanpa proses: dipakai saat spawn
    await client.session.prompt({ sessionID: SID, text: "x" });
    await tick();
    expect(calls[0]?.options.permissionMode).toBe("acceptEdits");
    // Pindah ke bypass nanti hanya DIIZINKAN, tidak diaktifkan.
    expect(calls[0]?.options.allowDangerouslySkipPermissions).toBe(true);
  });

  test("ganti mode di tengah turn -> setPermissionMode langsung ke proses", async () => {
    const { client, calls } = setup();
    await client.session.prompt({ sessionID: SID, text: "x" });
    await tick();
    const q = calls[0]?.query;
    q?.push(state("running"));
    await tick();
    expect((await client.session.setPermissionMode(SID, "plan")).ok).toBe(true);
    expect(q?.modes).toEqual(["plan"]);
    // Mode sama tidak dikirim ulang.
    await client.session.setPermissionMode(SID, "plan");
    expect(q?.modes).toEqual(["plan"]);
  });

  test("mode dari CLI (init/status) dipancarkan sekali per perubahan", async () => {
    const { client, calls, events } = setup();
    await client.session.prompt({ sessionID: SID, text: "x" });
    await tick();
    const q = calls[0]?.query;
    q?.push({ type: "system", subtype: "init", permissionMode: "default", mcp_servers: [] });
    q?.push({ type: "system", subtype: "status", status: null, permissionMode: "default" });
    q?.push({ type: "system", subtype: "status", status: null, permissionMode: "acceptEdits" });
    await tick();
    const changes = events.filter((e) => e.type === "agent.permission_mode.changed").map(data);
    expect(changes.map((d) => d.mode)).toEqual(["default", "acceptEdits"]);
    // Mode yang dilaporkan menjadi acuan: memilih mode yang sama tidak memicu kontrol.
    await client.session.setPermissionMode(SID, "acceptEdits");
    expect(q?.modes).toEqual([]);
  });

  test("ExitPlanMode -> form rencana; setuju mengganti mode, masukan menolak dengan pesan", async () => {
    const { client, calls, events } = setup();
    await client.session.prompt({ sessionID: SID, text: "x" });
    await tick();
    const canUseTool = calls[0]?.options.canUseTool;
    if (!canUseTool) throw new Error("canUseTool");
    const opts = { signal: new AbortController().signal, toolUseID: "t", requestId: "r" };
    const input = { plan: "## Rencana\n1. Ubah a.ts" };

    const p1 = canUseTool("ExitPlanMode", input, opts);
    const form1 = data(events.find((e) => e.type === "form.created")).form as {
      id: string;
      metadata: Record<string, unknown>;
      fields: { key: string; options: { value: string }[] }[];
    };
    expect(form1.metadata).toEqual({ kind: "plan", plan: input.plan });
    expect(form1.fields[0]?.options.map((o) => o.value)).toEqual([
      "acceptEdits",
      "default",
      "plan",
    ]);
    await client.form.reply({
      sessionID: SID,
      formID: form1.id,
      answer: { decision: "acceptEdits" },
    });
    expect(await p1).toEqual({
      behavior: "allow",
      updatedInput: input,
      updatedPermissions: [{ type: "setMode", mode: "acceptEdits", destination: "session" }],
    });

    const p2 = canUseTool("ExitPlanMode", input, opts);
    const form2 = data(events.filter((e) => e.type === "form.created").at(-1)).form as {
      id: string;
    };
    await client.form.reply({
      sessionID: SID,
      formID: form2.id,
      answer: { decision: "Tambah test dulu" },
    });
    expect(await p2).toEqual({
      behavior: "deny",
      message: "The user wants changes to the plan before implementing it: Tambah test dulu",
    });

    const p3 = canUseTool("ExitPlanMode", input, opts);
    const form3 = data(events.filter((e) => e.type === "form.created").at(-1)).form as {
      id: string;
    };
    expect((await client.form.cancel({ sessionID: SID, formID: form3.id })).ok).toBe(true);
    expect(await p3).toMatchObject({ behavior: "deny" });
  });
});
