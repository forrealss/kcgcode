/**
 * Client in-process Claude Code (`createClaudeClient`) dengan `query()`
 * palsu: spawn malas, resume, permission/form lewat `canUseTool`,
 * interrupt, lampiran, dan operasi Session lainnya.
 */
import { describe, expect, test } from "bun:test";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { AGENT_REQUEST_GONE } from "../../types";
import { CLAUDE_PROVIDER_ID } from "../constants";
import { data, SID, setup, state, tick } from "./harness";

describe("createClaudeClient", () => {
  test("prompt pertama spawn proses dengan settings user & sessionId baru", async () => {
    const { client, calls, events } = setup();
    const created = await client.session.create();
    if (!created.ok) throw new Error("create");
    expect(calls.length).toBe(0); // malas: belum ada proses

    await client.session.switchModel(created.data.id, {
      providerID: CLAUDE_PROVIDER_ID,
      modelID: "sonnet",
    });
    const res = await client.session.prompt({ sessionID: created.data.id, text: "hello" });
    expect(res.ok).toBe(true);
    await tick();
    expect(calls.length).toBe(1);
    const opts = calls[0]?.options as Options;
    expect(opts.cwd).toBe("/proj");
    expect(opts.settingSources).toEqual(["user", "project", "local"]);
    expect(opts.sessionId).toBe(created.data.id);
    expect(opts.resume).toBeUndefined();
    expect(opts.model).toBe("sonnet");
    expect(opts.permissionMode).toBeUndefined(); // ikut defaultMode user
    expect(opts.env?.CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS).toBe("1");
    expect(opts.env?.HOME).toBe("/home/u");
    expect(calls[0]?.inputs[0]?.message).toEqual({ role: "user", content: "hello" });
    expect(events[0]).toEqual({
      type: "session.execution.started",
      data: { sessionID: created.data.id },
    });
  });

  test("transcript sudah ada -> resume; model/mode diganti lewat kontrol", async () => {
    const { client, calls } = setup([SID]);
    expect((await client.session.get(SID)).ok).toBe(true);
    await client.session.setPermissionMode(SID, "plan");
    await client.session.prompt({ sessionID: SID, text: "a" });
    await tick();
    expect(calls[0]?.options.resume).toBe(SID);
    expect(calls[0]?.options.sessionId).toBeUndefined();
    expect(calls[0]?.options.permissionMode).toBe("plan");

    await client.session.switchModel(SID, { providerID: CLAUDE_PROVIDER_ID, modelID: "opus" });
    await client.session.setPermissionMode(SID, null);
    await client.session.prompt({ sessionID: SID, text: "b" });
    await tick();
    expect(calls.length).toBe(1); // proses dipakai ulang
    expect(calls[0]?.query.models).toEqual(["opus"]);
    expect(calls[0]?.query.modes).toEqual(["default"]);
    expect(calls[0]?.inputs.length).toBe(2);
  });

  test("MCP kcgcode ditambahkan ke proses (di atas MCP user) + tool baca-saja diizinkan", async () => {
    const { client, calls } = setup([], undefined, undefined, {
      extraMcp: () => ({
        servers: {
          kcg_preview: { type: "http", url: "http://127.0.0.1:3000/mcp/preview?project=p" },
        },
        allowedTools: ["mcp__kcg_preview__dev_server_status"],
      }),
    });
    await client.session.prompt({ sessionID: SID, text: "a" });
    await tick();
    expect(calls[0]?.options.mcpServers).toEqual({
      kcg_preview: { type: "http", url: "http://127.0.0.1:3000/mcp/preview?project=p" },
    });
    expect(calls[0]?.options.allowedTools).toEqual(["mcp__kcg_preview__dev_server_status"]);
  });

  test("instruksi Project berubah -> proses diganti dengan systemPrompt append", async () => {
    const { client, calls } = setup();
    await client.session.prompt({ sessionID: SID, text: "a" });
    await tick();
    expect(calls[0]?.options.systemPrompt).toBeUndefined();
    await client.session.instructions(SID, "Selalu jawab singkat.");
    await client.session.prompt({ sessionID: SID, text: "b" });
    await tick();
    expect(calls.length).toBe(2);
    expect(calls[0]?.query.closed).toBe(true);
    expect(calls[1]?.options.systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
      append: "Selalu jawab singkat.",
    });
  });

  test("idle -> execution.succeeded; result error -> execution.failed saat idle", async () => {
    const { client, calls, events } = setup();
    await client.session.prompt({ sessionID: SID, text: "x" });
    await tick();
    const q = calls[0]?.query;
    q?.push(state("running"));
    q?.push({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      errors: ["boom"],
    });
    q?.push(state("idle"));
    await tick();
    expect(events.at(-1)).toEqual({
      type: "session.execution.failed",
      data: { sessionID: SID, error: { type: "error_during_execution", message: "boom" } },
    });

    await client.session.prompt({ sessionID: SID, text: "y" });
    q?.push(state("running"));
    q?.push(state("idle"));
    await tick();
    expect(events.at(-1)).toEqual({
      type: "session.execution.succeeded",
      data: { sessionID: SID },
    });
  });

  test("permission: canUseTool -> permission.asked; reply once/always/reject", async () => {
    const { client, calls, events } = setup();
    await client.session.prompt({ sessionID: SID, text: "x" });
    await tick();
    const canUseTool = calls[0]?.options.canUseTool;
    if (!canUseTool) throw new Error("canUseTool");
    const signal = new AbortController().signal;
    const rule = {
      type: "addRules" as const,
      rules: [{ toolName: "Bash", ruleContent: "git *" }],
      behavior: "allow" as const,
    };
    const suggestions = [{ ...rule, destination: "localSettings" as const }];

    const p1 = canUseTool(
      "Bash",
      { command: "git status" },
      { signal, suggestions, toolUseID: "t1", requestId: "r1" },
    );
    const asked = events.find((e) => e.type === "permission.asked");
    expect(data(asked)).toMatchObject({
      sessionID: SID,
      action: "bash",
      resources: ["git status"],
    });
    const id = String(data(asked).id);
    const reply = (decision: "once" | "always" | "reject") =>
      client.permission.reply({ sessionID: SID, requestID: id, decision });
    expect((await reply("always")).ok).toBe(true);
    expect(await p1).toEqual({
      behavior: "allow",
      updatedInput: { command: "git status" },
      // "Always" berlaku per Session, tidak menulis file settings.
      updatedPermissions: [{ ...rule, destination: "session" }],
    });
    // Request sudah dijawab -> kedaluwarsa.
    expect(await reply("once")).toEqual({ ok: false, error: AGENT_REQUEST_GONE });

    const p2 = canUseTool(
      "Write",
      { file_path: "/x/y" },
      { signal, blockedPath: "/x", toolUseID: "t2", requestId: "r2" },
    );
    const asked2 = events.filter((e) => e.type === "permission.asked").at(-1);
    expect(data(asked2)).toMatchObject({ action: "external_directory", resources: ["/x"] });
    await client.permission.reply({
      sessionID: SID,
      requestID: String(data(asked2).id),
      decision: "reject",
    });
    expect(await p2).toMatchObject({ behavior: "deny" });
  });

  test("AskUserQuestion -> form.created; jawaban form dipetakan per teks pertanyaan", async () => {
    const { client, calls, events } = setup();
    await client.session.prompt({ sessionID: SID, text: "x" });
    await tick();
    const canUseTool = calls[0]?.options.canUseTool;
    if (!canUseTool) throw new Error("canUseTool");
    const input = {
      questions: [
        {
          question: "Which DB?",
          header: "DB",
          options: [
            { label: "Postgres", description: "" },
            { label: "SQLite", description: "" },
          ],
          multiSelect: false,
        },
        {
          question: "Extras?",
          header: "Extras",
          options: [
            { label: "Auth", description: "" },
            { label: "Cache", description: "" },
          ],
          multiSelect: true,
        },
      ],
    };
    const p = canUseTool("AskUserQuestion", input, {
      signal: new AbortController().signal,
      toolUseID: "t",
      requestId: "r",
    });
    const created = events.find((e) => e.type === "form.created");
    const form = data(created).form as { id: string; fields: Record<string, unknown>[] };
    expect(form.fields).toMatchObject([
      { key: "q0", type: "string", title: "DB", description: "Which DB?", custom: true },
      { key: "q1", type: "multiselect", title: "Extras", description: "Extras?" },
    ]);
    await client.form.reply({
      sessionID: SID,
      formID: form.id,
      answer: { q0: "SQLite", q1: ["Auth", "Cache"] },
    });
    expect(await p).toEqual({
      behavior: "allow",
      updatedInput: { ...input, answers: { "Which DB?": "SQLite", "Extras?": "Auth, Cache" } },
    });
  });

  test("interrupt: idle turn lama -> interrupted; prompt baru menunggu turn lama berhenti", async () => {
    const { client, calls, events } = setup();
    await client.session.prompt({ sessionID: SID, text: "first" });
    await tick();
    const q = calls[0]?.query;
    q?.push(state("running"));
    await tick();
    expect((await client.session.interrupt(SID)).ok).toBe(true);
    expect(q?.interrupted).toBe(1);

    let sent = false;
    const second = client.session.prompt({ sessionID: SID, text: "second" }).then(() => {
      sent = true;
    });
    await tick();
    expect(sent).toBe(false); // menunggu turn yang di-interrupt berhenti

    q?.push({ type: "result", subtype: "error_during_execution", is_error: true, errors: ["x"] });
    q?.push(state("idle"));
    await second;
    const ends = events.filter(
      (e) => e.type.startsWith("session.execution.") && e.type !== "session.execution.started",
    );
    expect(ends.map((e) => e.type)).toEqual(["session.execution.interrupted"]);
    expect(calls[0]?.inputs.length).toBe(2);

    q?.push(state("running"));
    q?.push(state("idle"));
    await tick();
    expect(events.at(-1)?.type).toBe("session.execution.succeeded");
  });

  test("proses mati di tengah turn -> session.execution.failed", async () => {
    const { client, calls, events } = setup();
    await client.session.prompt({ sessionID: SID, text: "x" });
    await tick();
    const q = calls[0]?.query;
    q?.push(state("running"));
    await tick();
    q?.end();
    await tick();
    expect(events.at(-1)).toMatchObject({
      type: "session.execution.failed",
      data: { sessionID: SID },
    });
  });

  test("gambar dikirim inline sebagai base64; @file dirujuk lewat path", async () => {
    const { client, calls } = setup();
    const file = path.join(import.meta.dir, "__fixture_claude.png");
    // Path absolut lintas OS (`/proj/…` di POSIX, `D:\proj\…` di Windows).
    const refPath = path.resolve("/proj/src/x.ts");
    await Bun.write(file, new Uint8Array([137, 80, 78, 71]));
    try {
      await client.session.prompt({
        sessionID: SID,
        text: "look",
        files: [
          { name: "a.png", mime: "image/png", uri: pathToFileURL(file).href },
          { name: "src/x.ts", mime: "text/plain", uri: pathToFileURL(refPath).href },
        ],
      });
      await tick();
      const content = calls[0]?.inputs[0]?.message.content as unknown as Record<string, unknown>[];
      expect(content[0]).toEqual({
        type: "text",
        text: `look\nReferenced files:\n- src/x.ts: ${refPath}`,
      });
      expect(content[1]).toMatchObject({
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "iVBORw==" },
      });
    } finally {
      await Bun.file(file).delete();
    }
  });

  test("model, agent, MCP, todos, hapus", async () => {
    const { client, calls, events, removed } = setup([SID]);
    const models = await client.model.list();
    // Tingkat effort per model; baris "default" = model Session tanpa pilihan.
    expect(models).toEqual({
      ok: true,
      data: [
        {
          providerID: CLAUDE_PROVIDER_ID,
          providerName: "Claude Code",
          modelID: "default",
          name: "Default (recommended)",
          efforts: ["low", "medium", "high", "xhigh", "max"],
          isDefault: true,
        },
        {
          providerID: CLAUDE_PROVIDER_ID,
          providerName: "Claude Code",
          modelID: "sonnet",
          name: "Sonnet",
          efforts: ["low", "medium", "high", "max"],
        },
        {
          providerID: CLAUDE_PROVIDER_ID,
          providerName: "Claude Code",
          modelID: "haiku-old",
          name: "Haiku",
        },
      ],
    });
    // Query sementara untuk daftar model langsung ditutup & tidak dipersist.
    expect(calls[0]?.query.closed).toBe(true);
    expect(calls[0]?.options.persistSession).toBe(false);

    // Claude Code memakai permission mode (capability), bukan agent percakapan.
    expect(await client.agent.list()).toEqual({ ok: true, data: [] });
    expect(client.capabilities.permissionModes.map((m) => m.id)).toEqual([
      "default",
      "acceptEdits",
      "plan",
      "auto",
      "dontAsk",
      "bypassPermissions",
    ]);

    await client.session.prompt({ sessionID: SID, text: "x" });
    await tick();
    const q = calls[1]?.query;
    q?.push({
      type: "assistant",
      message: {
        id: "m",
        content: [
          { type: "tool_use", id: "t", name: "TodoWrite", input: { todos: [{ content: "a" }] } },
        ],
      },
      parent_tool_use_id: null,
      uuid: "u",
    });
    await tick();
    const todos = [{ content: "a", status: "pending", priority: "medium" }];
    expect(await client.session.todos(SID)).toEqual({ ok: true, data: todos });
    expect(events.find((e) => e.type === "agent.todos.updated")).toEqual({
      type: "agent.todos.updated",
      data: { sessionID: SID, todos },
    });
    expect(await client.mcp.list()).toEqual({
      ok: true,
      data: [{ name: "fs", status: "connected", error: null }],
    });

    expect((await client.session.remove(SID)).ok).toBe(true);
    expect(q?.closed).toBe(true);
    expect(removed).toEqual([SID]);
  });
});
