/**
 * Adapter opencode v2: deteksi versi CLI, penerjemah event v2 -> `AgentEvent`,
 * dan backend (`@opencode/client` palsu): perutean event per direktori,
 * task list dari tool `todowrite`, reply kedaluwarsa, pemetaan daftar, dan
 * reconnect saat langganan event putus.
 */
import { describe, expect, test } from "bun:test";
import path from "node:path";
import { AGENT_REQUEST_GONE, type AgentEvent } from "../../types";
import { createOpencodeBackend, directoryKey, type OpencodeApi } from "../backend";
import { toAgentForm, translateOpencodeEvent } from "../translate";
import {
  checkOpencodeVersion,
  OPENCODE_NOT_FOUND,
  OPENCODE_UPGRADE_REQUIRED,
  parseOpencodeVersion,
} from "../version";

describe("versi opencode", () => {
  test("parse output `opencode --version`", () => {
    expect(parseOpencodeVersion("opencode v2.0.28\n")).toEqual({ version: "2.0.28", major: 2 });
    expect(parseOpencodeVersion("1.4.3")).toEqual({ version: "1.4.3", major: 1 });
    expect(parseOpencodeVersion("2.1.0-beta.3")).toEqual({ version: "2.1.0-beta.3", major: 2 });
    expect(parseOpencodeVersion("tidak ada versi")).toBeNull();
  });

  test("v1 -> OPENCODE_UPGRADE_REQUIRED; tidak terpasang -> OPENCODE_NOT_FOUND; v2 -> ok", async () => {
    expect(await checkOpencodeVersion(async () => ({ ok: true, output: "1.4.3" }))).toEqual({
      ok: false,
      error: `${OPENCODE_UPGRADE_REQUIRED}: 1.4.3`,
    });
    expect(
      await checkOpencodeVersion(async () => ({ ok: false, notFound: true, error: "ENOENT" })),
    ).toEqual({ ok: false, error: OPENCODE_NOT_FOUND });
    expect(
      await checkOpencodeVersion(async () => ({ ok: true, output: "opencode v2.0.28" })),
    ).toEqual({
      ok: true,
      data: { version: "2.0.28", major: 2 },
    });
  });
});

describe("translateOpencodeEvent", () => {
  test("event yang dipakai diteruskan apa adanya beserta location", () => {
    const raw = {
      id: "evt_1",
      type: "session.text.delta",
      location: { directory: "/proj" },
      data: { sessionID: "ses_1", assistantMessageID: "msg_1", ordinal: 0, delta: "Hi" },
    };
    expect(translateOpencodeEvent(raw)).toEqual({
      type: "session.text.delta",
      data: { sessionID: "ses_1", assistantMessageID: "msg_1", ordinal: 0, delta: "Hi" },
      location: { directory: "/proj" },
    });
  });

  test("event tak dipakai / tanpa sessionID dibuang", () => {
    expect(translateOpencodeEvent({ type: "server.connected", data: {} })).toBeNull();
    expect(translateOpencodeEvent({ type: "model.updated", data: {} })).toBeNull();
    expect(translateOpencodeEvent({ type: "session.text.delta", data: { delta: "x" } })).toBeNull();
    expect(translateOpencodeEvent("rusak")).toBeNull();
  });

  test("form.created dinormalkan ke AgentForm (opsi, custom, hidden)", () => {
    const ev = translateOpencodeEvent({
      type: "form.created",
      data: {
        form: {
          id: "frm_1",
          sessionID: "ses_1",
          title: "Questions",
          metadata: { kind: "question" },
          fields: [
            {
              key: "q0",
              title: "Color",
              description: "Which color?",
              type: "string",
              options: [{ value: "red", label: "Red" }, { label: "Blue" }],
              custom: true,
            },
            { key: "bad" },
          ],
        },
      },
    });
    expect(ev).toEqual({
      type: "form.created",
      data: {
        form: {
          id: "frm_1",
          sessionID: "ses_1",
          title: "Questions",
          metadata: { kind: "question" },
          fields: [
            {
              key: "q0",
              type: "string",
              title: "Color",
              description: "Which color?",
              options: [
                { value: "red", label: "Red" },
                { value: "Blue", label: "Blue" },
              ],
              custom: true,
            },
          ],
        },
      },
    });
    expect(toAgentForm({ id: "x", sessionID: "s", fields: [] })).toBeNull();
  });
});

/** API opencode palsu: langganan event bisa didorong & diputus dari test. */
function fakeApi(pid = 100) {
  const calls: [string, unknown][] = [];
  const queue: unknown[] = [];
  let wake: (() => void) | null = null;
  let ended = false;
  const errors = new Map<string, Error>();
  const rec =
    (name: string, result: unknown = {}) =>
    async (input: unknown) => {
      calls.push([name, input]);
      const err = errors.get(name);
      if (err) throw err;
      return typeof result === "function" ? (result as (i: unknown) => unknown)(input) : result;
    };
  const api: OpencodeApi = {
    server: { info: async () => ({ pid, version: "2.0.28" }) },
    session: {
      create: rec("session.create", { id: "ses_new", title: undefined }),
      get: rec("session.get", { id: "ses_x", location: { directory: "/proj" } }),
      remove: rec("session.remove"),
      switchModel: rec("session.switchModel"),
      switchAgent: rec("session.switchAgent"),
      prompt: rec("session.prompt"),
      interrupt: rec("session.interrupt", { interrupted: true }),
      instructions: {
        entry: { put: rec("instructions.put"), remove: rec("instructions.remove") },
      },
      form: { reply: rec("form.reply"), cancel: rec("form.cancel") },
    },
    permission: { reply: rec("permission.reply") },
    model: {
      list: rec("model.list", {
        data: [
          {
            id: "big-pickle",
            providerID: "opencode",
            name: "Big Pickle",
            status: "active",
            variants: [{ id: "low" }, { id: "high", body: { effort: "high" } }, {}],
          },
          { id: "small", providerID: "opencode", name: "Small", status: "active", variants: [] },
          { id: "old", providerID: "opencode", name: "Old", status: "deprecated" },
          { id: "off", providerID: "opencode", name: "Off", enabled: false },
        ],
      }),
      default: rec("model.default", { data: { id: "big-pickle", providerID: "opencode" } }),
    },
    provider: { list: rec("provider.list", { data: [{ id: "opencode", name: "OpenCode" }] }) },
    agent: {
      list: rec("agent.list", {
        data: [
          { id: "build", name: "Build", mode: "primary", hidden: false, description: "Default" },
          { id: "explore", name: "Explore", mode: "subagent", hidden: false },
          { id: "title", name: "Title", mode: "primary", hidden: true },
        ],
      }),
    },
    mcp: {
      list: rec("mcp.list", {
        data: [
          { name: "z", status: { status: "failed", error: "boom" } },
          { name: "a", status: { status: "connected" } },
          { name: "p", status: { status: "pending" } },
        ],
      }),
    },
    skill: {
      list: rec("skill.list", (input: unknown) => {
        const dir = (input as { location: { directory: string } }).location.directory;
        return {
          data: [
            { id: "opencode", name: "OpenCode", path: "/builtin/opencode.md" },
            {
              id: "local",
              name: "local",
              path: path.join(dir, ".agents", "skills", "local", "SKILL.md"),
            },
            {
              id: "global",
              name: "global",
              path: path.resolve("/home/u/.agents/skills/global/SKILL.md"),
            },
          ],
        };
      }),
    },
    file: { find: rec("file.find", { data: [{ path: "src/a.ts", type: "file" }] }) },
    vcs: {
      status: rec("vcs.status", {
        data: [{ file: "src/a.ts", additions: 3, deletions: 1, status: "modified" }],
      }),
    },
    location: { reload: rec("location.reload") },
    event: {
      subscribe(_input, options) {
        options?.signal?.addEventListener("abort", () => {
          ended = true;
          wake?.();
        });
        return {
          async *[Symbol.asyncIterator]() {
            for (;;) {
              const next = queue.shift();
              if (next !== undefined) {
                yield next;
                continue;
              }
              if (ended) return;
              await new Promise<void>((r) => {
                wake = r;
              });
              wake = null;
            }
          },
        };
      },
    },
  };
  return {
    api,
    calls,
    errors,
    push(ev: unknown) {
      queue.push(ev);
      wake?.();
    },
    /** Putus langganan event (service mati / koneksi hilang). */
    drop() {
      ended = true;
      wake?.();
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

function setup(opts: { version?: string; pids?: number[] } = {}) {
  const pids = [...(opts.pids ?? [100])];
  const apis: ReturnType<typeof fakeApi>[] = [];
  const backend = createOpencodeBackend({
    versionProbe: async () => ({ ok: true, output: opts.version ?? "opencode v2.0.28" }),
    connect: async () => {
      const f = fakeApi(pids.shift() ?? 100);
      apis.push(f);
      return f.api;
    },
    reconnectDelayMs: 1,
    maxReconnectDelayMs: 2,
  });
  return { backend, apis };
}

const PROJ = path.resolve("/proj");
const OTHER = path.resolve("/lain");

describe("createOpencodeBackend", () => {
  test("CLI v1 -> ensure gagal dengan OPENCODE_UPGRADE_REQUIRED", async () => {
    const { backend, apis } = setup({ version: "1.4.3" });
    expect(await backend.ensure("p1", PROJ)).toEqual({
      ok: false,
      error: `${OPENCODE_UPGRADE_REQUIRED}: 1.4.3`,
    });
    expect(apis).toHaveLength(0); // service v2 tidak disentuh
  });

  test("satu koneksi untuk semua Project; client stabil per Project", async () => {
    const { backend, apis } = setup();
    const a = await backend.ensure("p1", PROJ);
    const b = await backend.ensure("p2", OTHER);
    const a2 = await backend.ensure("p1", PROJ);
    if (!a.ok || !b.ok || !a2.ok) throw new Error("ensure");
    expect(apis).toHaveLength(1);
    expect(a2.data).toBe(a.data);
    expect(backend.get("p2")).toBe(b.data);
  });

  test("event dirutekan ke client sesuai direktori Session", async () => {
    const { backend, apis } = setup();
    const a = await backend.ensure("p1", PROJ);
    const b = await backend.ensure("p2", OTHER);
    if (!a.ok || !b.ok) throw new Error("ensure");
    const evA: AgentEvent[] = [];
    const evB: AgentEvent[] = [];
    a.data.event.subscribe((e) => evA.push(e));
    b.data.event.subscribe((e) => evB.push(e));
    const created = await a.data.session.create();
    if (!created.ok) throw new Error("create");

    const api = apis[0];
    // Event dengan location direktori lain -> hanya ke client itu.
    api?.push({
      type: "session.text.delta",
      location: { directory: OTHER },
      data: { sessionID: "ses_other", assistantMessageID: "m", ordinal: 0, delta: "x" },
    });
    // Event TANPA location milik Session yang dibuat client A -> ke A.
    api?.push({ type: "session.execution.succeeded", data: { sessionID: "ses_new" } });
    // Session asing (aplikasi opencode lain) tanpa location -> dibuang.
    api?.push({ type: "session.execution.succeeded", data: { sessionID: "ses_asing" } });
    await tick();
    expect(evA.map((e) => e.type)).toEqual(["session.execution.succeeded"]);
    expect(evB.map((e) => e.type)).toEqual(["session.text.delta"]);
  });

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
        { name: "p", status: "unknown", error: null },
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

  test("langganan putus: service sama -> sambung ulang tanpa onLost; service baru -> onLost", async () => {
    const { backend, apis } = setup({ pids: [100, 100, 200] });
    const r = await backend.ensure("p1", PROJ);
    if (!r.ok) throw new Error("ensure");
    const lost: string[] = [];
    backend.onLost((id) => lost.push(id));
    const events: AgentEvent[] = [];
    r.data.event.subscribe((e) => events.push(e));

    apis[0]?.drop();
    await tick();
    await tick();
    expect(apis).toHaveLength(2);
    expect(lost).toEqual([]);
    // Client lama tetap menerima event dari koneksi baru.
    apis[1]?.push({
      type: "session.execution.succeeded",
      location: { directory: PROJ },
      data: { sessionID: "ses_1" },
    });
    await tick();
    expect(events.map((e) => e.type)).toEqual(["session.execution.succeeded"]);

    apis[1]?.drop();
    await tick();
    await tick();
    expect(apis).toHaveLength(3);
    expect(lost).toEqual(["p1"]);
    await backend.shutdown();
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

  test("directoryKey menyamakan pemisah & (Windows) huruf besar/kecil", () => {
    expect(directoryKey(PROJ)).toBe(directoryKey(`${PROJ}${path.sep}`));
    if (process.platform === "win32")
      expect(directoryKey("C:\\Proj")).toBe(directoryKey("c:/proj"));
  });
});
