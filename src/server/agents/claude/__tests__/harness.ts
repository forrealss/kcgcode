/**
 * Harness test adapter Claude Code (bukan file test): `query()` palsu yang
 * mencatat input & opsi (pesan SDK didorong dari test), `setup()` client
 * in-process di atasnya, dan helper kecil yang dipakai bersama.
 */
import type {
  Options,
  SDKMessage,
  SDKSessionInfo,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent } from "../../types";
import { createClaudeClient } from "../client";
import type { DesktopSessionMeta, RunningClaudeSession } from "../host-sessions";
import type { ClaudeQueryLike, ClaudeTranscriptMessage } from "../sdk";

export const SID = "11111111-1111-4111-8111-111111111111";

/** `data` event (union) sebagai record untuk asersi. */
export const data = (ev: AgentEvent | undefined) => (ev?.data ?? {}) as Record<string, unknown>;

/** `query()` palsu: mencatat input & opsi, pesan SDK didorong dari test. */
export function fakeQuery(
  mcp: { name: string; status: string }[] = [{ name: "fs", status: "connected" }],
) {
  const calls: { options: Options; inputs: SDKUserMessage[]; query: FakeQ }[] = [];
  type FakeQ = ClaudeQueryLike & {
    push(m: Record<string, unknown>): void;
    end(): void;
    interrupted: number;
    models: string[];
    /** `effortLevel` per `applyFlagSettings` (null = default model). */
    efforts: (string | null)[];
    usageCalls: number;
    modes: string[];
    closed: boolean;
    /** Request kontrol MCP/skill (`toggle:<nama>:<on>`, `reconnect:<nama>`, `reloadSkills`). */
    controls: string[];
    /** Status MCP yang dilaporkan `mcpServerStatus` (diubah oleh toggle). */
    mcp: { name: string; status: string; error?: string }[];
    /** Error yang dilempar request kontrol MCP berikutnya. */
    mcpError: Error | null;
  };
  const fn = (params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => {
    const inputs: SDKUserMessage[] = [];
    void (async () => {
      for await (const m of params.prompt) inputs.push(m);
    })();
    const queue: SDKMessage[] = [];
    let wake: (() => void) | null = null;
    let done = false;
    const q: FakeQ = {
      interrupted: 0,
      models: [],
      efforts: [],
      usageCalls: 0,
      modes: [],
      closed: false,
      controls: [],
      mcp: mcp.map((s) => ({ ...s })),
      mcpError: null,
      push(m) {
        queue.push(m as unknown as SDKMessage);
        wake?.();
      },
      end() {
        done = true;
        wake?.();
      },
      async interrupt() {
        q.interrupted += 1;
      },
      async setModel(model) {
        q.models.push(model ?? "");
      },
      async setPermissionMode(mode) {
        q.modes.push(mode);
      },
      async applyFlagSettings(settings) {
        if ("effortLevel" in settings) q.efforts.push(settings.effortLevel ?? null);
      },
      async supportedModels() {
        return [
          {
            value: "default",
            displayName: "Default (recommended)",
            description: "",
            supportsEffort: true,
            supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
          },
          {
            value: "sonnet",
            displayName: "Sonnet",
            description: "",
            supportsEffort: true,
            supportedEffortLevels: ["low", "medium", "high", "max"],
          },
          { value: "haiku-old", displayName: "Haiku", description: "" },
        ];
      },
      async getContextUsage() {
        q.usageCalls += 1;
        return {
          totalTokens: 50_000,
          maxTokens: 200_000,
          rawMaxTokens: 200_000,
          percentage: 25,
          model: "claude-sonnet",
          autoCompactThreshold: 167_000,
          isAutoCompactEnabled: true,
          categories: [
            { name: "System tools", tokens: 20_000, color: "", kind: "used" },
            { name: "Messages", tokens: 30_000, color: "", kind: "used" },
            { name: "MCP tools (deferred)", tokens: 9_000, color: "", kind: "deferred" },
            { name: "Free space", tokens: 117_000, color: "", kind: "free" },
          ],
        } as unknown as Awaited<ReturnType<ClaudeQueryLike["getContextUsage"]>>;
      },
      async supportedCommands() {
        return [
          { name: "review", description: "Review changes ", argumentHint: "[pr#]", builtin: true },
          { name: "clear", description: "New session", argumentHint: "", builtin: true },
          { name: "__internal", description: "x", argumentHint: "", builtin: true },
          {
            name: "remotion:docs",
            description: "(Remotion) Search docs",
            argumentHint: "",
            aliases: ["docs"],
          },
          // Command kustom boleh bernama sama dengan bawaan yang disembunyikan.
          { name: "model", description: "Project command", argumentHint: "<name>" },
        ];
      },
      async mcpServerStatus() {
        return q.mcp as Awaited<ReturnType<ClaudeQueryLike["mcpServerStatus"]>>;
      },
      async toggleMcpServer(name, enabled) {
        q.controls.push(`toggle:${name}:${enabled}`);
        q.mcp = q.mcp.map((s) =>
          s.name === name ? { name, status: enabled ? "connected" : "disabled" } : s,
        );
        if (q.mcpError) throw q.mcpError;
      },
      async reconnectMcpServer(name) {
        q.controls.push(`reconnect:${name}`);
        if (q.mcpError) throw q.mcpError;
      },
      async reloadSkills() {
        q.controls.push("reloadSkills");
        return { skills: [] };
      },
      close() {
        q.closed = true;
        q.end();
      },
      async *[Symbol.asyncIterator]() {
        for (;;) {
          const next = queue.shift();
          if (next) {
            yield next;
            continue;
          }
          if (done) return;
          await new Promise<void>((r) => {
            wake = r;
          });
          wake = null;
        }
      },
    };
    calls.push({ options: params.options, inputs, query: q });
    return q;
  };
  return { fn, calls };
}

export const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Transcript & proses Claude Code lain (Desktop / CLI) palsu: daftar Session
 * di direktori, pesan per Session, fork, dan Session yang sedang dipegang
 * proses lain — semuanya bisa diubah dari test.
 */
export function fakeHostState() {
  return {
    infos: [] as SDKSessionInfo[],
    messages: new Map<string, ClaudeTranscriptMessage[]>(),
    forks: [] as { from: string; title?: string; id: string }[],
    running: new Map<string, RunningClaudeSession>(),
    desktop: new Map<string, DesktopSessionMeta>(),
  };
}

export function setup(
  existing: string[] = [],
  mcp?: Parameters<typeof fakeQuery>[0],
  external = fakeHostState(),
) {
  const { fn, calls } = fakeQuery(mcp);
  const removed: string[] = [];
  const client = createClaudeClient("/proj", {
    query: fn,
    deleteSettleMs: 0,
    env: { HOME: "/home/u" },
    transcripts: {
      async exists(id) {
        return existing.includes(id);
      },
      async remove(id) {
        removed.push(id);
        existing.splice(existing.indexOf(id), 1);
      },
      async list() {
        return external.infos;
      },
      async messages(id) {
        return external.messages.get(id) ?? [];
      },
      async fork(id, _dir, title) {
        const forked = `fork-${external.forks.length + 1}`;
        external.forks.push({ from: id, id: forked, ...(title ? { title } : {}) });
        existing.push(forked);
        return forked;
      },
    },
    host: {
      running: async () => external.running,
      desktop: async () => external.desktop,
    },
  });
  const events: AgentEvent[] = [];
  client.event.subscribe((ev) => events.push(ev));
  return { client, calls, events, removed, external };
}

export const state = (s: string) => ({
  type: "system",
  subtype: "session_state_changed",
  state: s,
});
