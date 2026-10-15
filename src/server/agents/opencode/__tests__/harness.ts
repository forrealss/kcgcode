/**
 * Harness test backend opencode v2 (bukan file test): `@opencode/client`
 * palsu (`fakeApi`), `setup()` backend di atasnya, dan direktori Project
 * contoh.
 */
import path from "node:path";
import { createOpencodeBackend, type OpencodeApi } from "../backend";

/** API opencode palsu: langganan event bisa didorong & diputus dari test. */
export function fakeApi(pid = 100) {
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
      command: rec("session.command"),
      compact: rec("session.compact"),
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
            limit: { context: 200_000, output: 32_000 },
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
      connect: rec("mcp.connect"),
      disconnect: rec("mcp.disconnect"),
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
    command: {
      list: rec("command.list", {
        data: [{ name: "review", description: "Review changes" }, { name: "init" }, {}],
      }),
    },
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

export const tick = () => new Promise((r) => setTimeout(r, 5));

export function setup(opts: { version?: string; pids?: number[] } = {}) {
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

export const PROJ = path.resolve("/proj");

export const OTHER = path.resolve("/lain");
