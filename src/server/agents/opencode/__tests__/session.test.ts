/**
 * Operasi Session opencode (`session.ts` / `usage.ts`) dengan API palsu:
 * task list, pemakaian konteks, compact, reply kedaluwarsa, pilihan Session,
 * thinking effort, slash command, prompt, dan permission mode.
 */
import { describe, expect, test } from "bun:test";
import { AGENT_REQUEST_GONE, type AgentEvent } from "../../types";
import { parseSlashCommand } from "../backend";
import { PROJ, setup, tick } from "./harness";

describe("createOpencodeBackend", () => {
  test("task list dirakit dari tool `todowrite`", async () => {
    const { backend, apis } = setup();
    const r = await backend.ensure("p1", PROJ);
    if (!r.ok) throw new Error("ensure");
    const events: AgentEvent[] = [];
    r.data.event.subscribe((e) => events.push(e));
    const loc = { location: { directory: PROJ } };
    const base = { sessionID: "ses_1", assistantMessageID: "m", id: "call_1" };
    apis[0]?.push({
      type: "session.tool.input.started",
      ...loc,
      data: { ...base, name: "todowrite" },
    });
    apis[0]?.push({
      type: "session.tool.called",
      ...loc,
      data: {
        ...base,
        input: { todos: [{ content: "a", status: "in_progress", priority: "high" }] },
      },
    });
    await tick();
    const todos = [{ content: "a", status: "in_progress", priority: "high" }];
    expect(await r.data.session.todos("ses_1")).toEqual({ ok: true, data: todos });
    expect(events.at(-1)).toEqual({
      type: "agent.todos.updated",
      data: { sessionID: "ses_1", todos },
    });
  });

  test("pemakaian konteks = token step terakhir vs limit.context model; reset setelah compact", async () => {
    const { backend, apis } = setup();
    const r = await backend.ensure("p1", PROJ);
    if (!r.ok) throw new Error("ensure");
    const events: AgentEvent[] = [];
    r.data.event.subscribe((e) => events.push(e));
    expect(await r.data.session.contextUsage("ses_1")).toEqual({ ok: true, data: null });
    const loc = { location: { directory: PROJ } };
    const step = { sessionID: "ses_1", assistantMessageID: "m1" };
    apis[0]?.push({
      type: "session.step.started",
      ...loc,
      data: { ...step, model: { id: "big-pickle", providerID: "opencode" } },
    });
    apis[0]?.push({
      type: "session.step.ended",
      ...loc,
      data: {
        ...step,
        finish: "stop",
        cost: 0,
        tokens: { input: 1_000, output: 500, reasoning: 100, cache: { read: 48_000, write: 400 } },
      },
    });
    await tick();
    const usage = await r.data.session.contextUsage("ses_1");
    expect(usage.ok && usage.data).toMatchObject({
      usedTokens: 50_000,
      maxTokens: 200_000,
      percent: 25,
      autoCompactAt: null,
      model: "big-pickle",
      categories: [],
    });

    // Event compaction v2 -> `agent.compaction`; ukuran sebelum dari step terakhir.
    apis[0]?.push({
      type: "session.compaction.started",
      ...loc,
      data: { sessionID: "ses_1", reason: "manual", recent: "" },
    });
    apis[0]?.push({
      type: "session.compaction.ended",
      ...loc,
      data: { sessionID: "ses_1", reason: "manual", text: "ringkasan", recent: "" },
    });
    apis[0]?.push({
      type: "session.compaction.failed",
      ...loc,
      data: {
        sessionID: "ses_1",
        reason: "auto",
        error: { type: "compaction.unavailable", message: "Nothing to compact" },
      },
    });
    await tick();
    expect(events.filter((e) => e.type === "agent.compaction").map((e) => e.data)).toEqual([
      { sessionID: "ses_1", phase: "started", trigger: "manual" },
      { sessionID: "ses_1", phase: "ended", trigger: "manual", preTokens: 50_000 },
      {
        sessionID: "ses_1",
        phase: "failed",
        trigger: "auto",
        error: { type: "compaction.unavailable", message: "Nothing to compact" },
      },
    ]);
    // Angka lama tidak berlaku lagi sampai step berikutnya.
    expect(await r.data.session.contextUsage("ses_1")).toEqual({ ok: true, data: null });
  });

  test("`/compact` -> API compact opencode (bukan session.command)", async () => {
    const { backend, apis } = setup();
    const r = await backend.ensure("p1", PROJ);
    if (!r.ok) throw new Error("ensure");
    await r.data.session.prompt({ sessionID: "ses_1", text: "/compact" });
    const names = (apis[0]?.calls ?? []).map(([n]) => n);
    expect(names).toContain("session.compact");
    expect(names).not.toContain("session.command");
    expect(names).not.toContain("session.prompt");
  });

  test("reply request yang sudah tidak ditunggu -> AGENT_REQUEST_GONE; hapus session hilang = ok", async () => {
    const { backend, apis } = setup();
    const r = await backend.ensure("p1", PROJ);
    if (!r.ok) throw new Error("ensure");
    const notFound = (tag: string) => Object.assign(new Error("not found"), { _tag: tag });
    apis[0]?.errors.set("permission.reply", notFound("PermissionNotFoundError"));
    apis[0]?.errors.set("form.reply", notFound("FormAlreadySettledError"));
    apis[0]?.errors.set("session.remove", notFound("SessionNotFoundError"));
    expect(
      await r.data.permission.reply({ sessionID: "s", requestID: "per_1", decision: "once" }),
    ).toEqual({ ok: false, error: AGENT_REQUEST_GONE });
    expect(
      await r.data.form.reply({ sessionID: "s", formID: "frm_1", answer: { q0: "a" } }),
    ).toEqual({
      ok: false,
      error: AGENT_REQUEST_GONE,
    });
    expect(await r.data.session.remove("ses_gone")).toEqual({ ok: true });
  });

  test("pilihan Session diterapkan sekali; null kembali ke default", async () => {
    const { backend, apis } = setup();
    const r = await backend.ensure("p1", PROJ);
    if (!r.ok) throw new Error("ensure");
    const s = r.data.session;
    const model = { providerID: "opencode", modelID: "big-pickle" };
    await s.switchModel("ses_1", model);
    await s.switchModel("ses_1", model);
    await s.switchModel("ses_1", null);
    await s.switchAgent("ses_1", null); // belum pernah diganti -> tanpa RPC
    await s.instructions("ses_1", "Jawab singkat.");
    await s.instructions("ses_1", "Jawab singkat.");
    await s.instructions("ses_1", null);
    const names = apis[0]?.calls.map(([n]) => n) ?? [];
    expect(names.filter((n) => n === "session.switchModel")).toHaveLength(2);
    expect(names).toContain("model.default");
    expect(names).not.toContain("session.switchAgent");
    expect(names.filter((n) => n === "instructions.put")).toHaveLength(1);
    expect(names.filter((n) => n === "instructions.remove")).toHaveLength(1);
  });

  test("thinking effort dikirim sebagai variant model; default model ikut variant", async () => {
    const { backend, apis } = setup();
    const r = await backend.ensure("p1", PROJ);
    if (!r.ok) throw new Error("ensure");
    const s = r.data.session;
    const model = { providerID: "opencode", modelID: "big-pickle" };
    await s.switchModel("ses_1", model, "high");
    await s.switchModel("ses_1", model, "high");
    await s.switchModel("ses_1", model, null);
    await s.switchModel("ses_2", null, "low");
    const switches = (apis[0]?.calls ?? [])
      .filter(([n]) => n === "session.switchModel")
      .map(([, input]) => input);
    expect(switches).toEqual([
      { sessionID: "ses_1", model: { id: "big-pickle", providerID: "opencode", variant: "high" } },
      { sessionID: "ses_1", model: { id: "big-pickle", providerID: "opencode" } },
      { sessionID: "ses_2", model: { id: "big-pickle", providerID: "opencode", variant: "low" } },
    ]);
  });

  test("slash command: daftar dari command.list; `/nama` dikenal -> session.command", async () => {
    const { backend, apis } = setup();
    const r = await backend.ensure("p1", PROJ);
    if (!r.ok) throw new Error("ensure");
    expect(await r.data.command.list()).toEqual({
      ok: true,
      data: [
        // `/compact` ditambahkan adapter (API compact opencode).
        {
          name: "compact",
          description: "Summarize the conversation so far to free up context",
          argumentHint: null,
          builtin: true,
        },
        { name: "init", description: null, argumentHint: null },
        { name: "review", description: "Review changes", argumentHint: null },
      ],
    });
    const files = [{ uri: "file:///proj/a.ts", name: "a.ts", mime: "text/plain" }];
    await r.data.session.prompt({ sessionID: "ses_1", text: "/review  fokus ke API ", files });
    await r.data.session.prompt({ sessionID: "ses_1", text: "/usr/bin bukan command" });
    const calls = apis[0]?.calls ?? [];
    expect(calls.find(([n]) => n === "session.command")?.[1]).toEqual({
      sessionID: "ses_1",
      name: "review",
      text: "fokus ke API",
      files: [{ uri: "file:///proj/a.ts", name: "a.ts" }],
    });
    expect(calls.filter(([n]) => n === "session.prompt").map(([, i]) => i)).toEqual([
      { sessionID: "ses_1", text: "/usr/bin bukan command" },
    ]);
    // Daftar di-cache untuk perutean: tidak dimuat ulang tiap prompt.
    expect(calls.filter(([n]) => n === "command.list")).toHaveLength(1);
  });

  test("parseSlashCommand: hanya `/nama` di awal teks", () => {
    expect(parseSlashCommand("/init")).toEqual({ name: "init", args: "" });
    expect(parseSlashCommand(" /review a\nb ")).toEqual({ name: "review", args: "a\nb" });
    expect(parseSlashCommand("halo /review")).toBeNull();
    expect(parseSlashCommand("/")).toBeNull();
    expect(parseSlashCommand("// komentar")).toBeNull();
  });

  test("prompt meneruskan teks + lampiran sebagai uri", async () => {
    const { backend, apis } = setup();
    const r = await backend.ensure("p1", PROJ);
    if (!r.ok) throw new Error("ensure");
    await r.data.session.prompt({
      sessionID: "ses_1",
      text: "lihat",
      files: [{ uri: "file:///proj/a.png", name: "a.png", mime: "image/png" }],
    });
    expect(apis[0]?.calls.find(([n]) => n === "session.prompt")?.[1]).toEqual({
      sessionID: "ses_1",
      text: "lihat",
      files: [{ uri: "file:///proj/a.png", name: "a.png" }],
    });
  });

  test("tanpa permission mode: capability kosong, hanya null yang diterima", async () => {
    const { backend } = setup();
    const r = await backend.ensure("p1", PROJ);
    if (!r.ok) throw new Error("ensure");
    expect(r.data.capabilities.permissionModes).toEqual([]);
    expect(await r.data.session.setPermissionMode("ses_1", null)).toEqual({ ok: true });
    expect(await r.data.session.setPermissionMode("ses_1", "plan")).toEqual({
      ok: false,
      error: "AGENT_PERMISSION_MODE_UNSUPPORTED",
    });
  });
});
