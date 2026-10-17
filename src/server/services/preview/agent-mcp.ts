/**
 * Server MCP "kcg_preview" untuk agent: dev server Project dipegang kcgcode,
 * agent melihat status, log, dan me-restart-nya lewat tool — bukan
 * menjalankan `npm run dev` sendiri di shell background.
 *
 * Transport Streamable HTTP versi minimal: setiap POST berisi satu pesan
 * JSON-RPC dan dijawab JSON biasa (tanpa stream/sesi), cukup untuk
 * `initialize`, `tools/list`, dan `tools/call`.
 *
 * Endpoint ada di app utama (`/mcp/preview?project=<id>`) di luar `/api/*`
 * (tidak memakai cookie kunci aplikasi); aksesnya dijaga token Bearer per
 * Project = HMAC(secret acak per proses kcgcode, projectId). Token hanya
 * diberikan ke proses agent milik Project itu.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { DevServerStatus } from "../../../types";
import type { Result } from "../../result";
import type { DevServerManager } from "./dev-servers";
import { formatCommand, type LaunchConfig } from "./launch-config";

export const AGENT_MCP_PATH = "/mcp/preview";
export const AGENT_MCP_NAME = "kcg_preview";

/** Tool baca-saja: boleh tanpa izin. `dev_server_restart` tetap minta izin. */
export const AGENT_MCP_READONLY_TOOLS = [
  `mcp__${AGENT_MCP_NAME}__dev_server_status`,
  `mcp__${AGENT_MCP_NAME}__dev_server_logs`,
];

/**
 * Instruksi sistem untuk Session agent yang punya tool ini. Statis (tanpa
 * port) agar tidak mengubah system prompt — dan me-restart proses agent —
 * setiap kali dev server berubah.
 */
export const AGENT_PREVIEW_INSTRUCTIONS = `KCG Code runs this project's dev server so the user can preview the app from their phone. Don't start a dev server yourself (for example \`npm run dev\` in a background shell): use the ${AGENT_MCP_NAME} tools instead. dev_server_status shows whether it's running and on which port, dev_server_logs shows its recent output (check it after changes that could break the build), and dev_server_restart starts or restarts it (needed after changing dependencies or config the dev server doesn't hot-reload). If there's no dev server config, add a "dev" script to package.json or create .claude/launch.json like {"version":"0.0.1","configurations":[{"name":"web","runtimeExecutable":"bun","runtimeArgs":["run","dev"],"port":5173}]}.`;

export interface AgentMcpDeps {
  devServers: DevServerManager;
  /** Path Project, atau null bila tidak ada. */
  projectPath: (projectId: string) => string | null;
  resolveConfig: (projectPath: string) => LaunchConfig | null;
  /** Batas tunggu restart sampai server siap/crash (ms). */
  restartWaitMs?: number;
}

export interface AgentMcp {
  /** Token Bearer untuk proses agent milik Project ini. */
  tokenFor(projectId: string): string;
  handle(req: Request): Promise<Response>;
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const TOOLS = [
  {
    name: "dev_server_status",
    description:
      "Status of the project's dev server that KCG Code runs for the user's preview: phase, port, command.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "dev_server_logs",
    description: "Recent output (stdout/stderr) of the project's dev server.",
    inputSchema: {
      type: "object",
      properties: {
        lines: { type: "number", description: "How many recent lines (default 80, max 300)." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "dev_server_restart",
    description:
      "Start the project's dev server, or restart it if it's running. Waits until it's ready or fails, then returns its status and recent output.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

function describe(status: DevServerStatus | null, cfg: LaunchConfig | null): string {
  const config = cfg
    ? `Config: ${formatCommand(cfg.argv)} (from ${cfg.source})`
    : 'Config: none. Add a "dev" script to package.json or a .claude/launch.json.';
  if (!status) return `Dev server: not started.\n${config}`;
  const where = status.port ? ` on port ${status.port}` : "";
  const by = status.external ? " (a server the agent started, adopted for the preview)" : "";
  const exit = status.exitCode !== null ? ` (exit code ${status.exitCode})` : "";
  return `Dev server: ${status.phase}${where}${by}${exit}.\nCommand: ${status.command}\n${config}`;
}

function tail(devServers: DevServerManager, projectId: string, lines: number): string {
  const all = devServers.logs(projectId, 0).lines;
  return all.slice(-lines).join("\n") || "(no output yet)";
}

export function createAgentMcp(deps: AgentMcpDeps): AgentMcp {
  const secret = randomBytes(32);
  const restartWaitMs = deps.restartWaitMs ?? 30_000;

  function tokenFor(projectId: string): string {
    return createHmac("sha256", secret).update(projectId).digest("base64url");
  }

  function authorized(req: Request, projectId: string): boolean {
    const header = req.headers.get("authorization") ?? "";
    const got = Buffer.from(header.replace(/^Bearer\s+/i, ""));
    const want = Buffer.from(tokenFor(projectId));
    return got.length === want.length && timingSafeEqual(got, want);
  }

  async function restart(projectId: string, cfg: LaunchConfig | null): Promise<Result<string>> {
    if (!cfg) return { ok: false, error: describe(deps.devServers.status(projectId), null) };
    const res = await deps.devServers.start(projectId, cfg);
    if (!res.ok) return { ok: false, error: res.error };
    const deadline = Date.now() + restartWaitMs;
    let status = deps.devServers.status(projectId);
    while (status?.phase === "starting" && Date.now() < deadline) {
      await Bun.sleep(250);
      status = deps.devServers.status(projectId);
    }
    const text = `${describe(status, cfg)}\n\nRecent output:\n${tail(deps.devServers, projectId, 40)}`;
    return status?.phase === "running" || status?.phase === "starting"
      ? { ok: true, data: text }
      : { ok: false, error: text };
  }

  async function callTool(
    projectId: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ text: string; isError: boolean }> {
    const projectPath = deps.projectPath(projectId);
    if (!projectPath) return { text: "Project not found.", isError: true };
    const cfg = deps.resolveConfig(projectPath);
    switch (name) {
      case "dev_server_status":
        return { text: describe(deps.devServers.status(projectId), cfg), isError: false };
      case "dev_server_logs": {
        const n =
          typeof args.lines === "number" ? Math.min(Math.max(Math.floor(args.lines), 1), 300) : 80;
        return { text: tail(deps.devServers, projectId, n), isError: false };
      }
      case "dev_server_restart": {
        const res = await restart(projectId, cfg);
        return res.ok ? { text: res.data, isError: false } : { text: res.error, isError: true };
      }
      default:
        return { text: `Unknown tool: ${name}`, isError: true };
    }
  }

  function reply(id: JsonRpcRequest["id"], result: unknown): Response {
    return Response.json({ jsonrpc: "2.0", id: id ?? null, result });
  }

  function error(id: JsonRpcRequest["id"], code: number, message: string, status = 200): Response {
    return Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status });
  }

  async function handle(req: Request): Promise<Response> {
    const projectId = new URL(req.url).searchParams.get("project") ?? "";
    if (!projectId || !authorized(req, projectId)) {
      return new Response("Unauthorized", { status: 401 });
    }
    // Tanpa stream server -> client (GET) dan tanpa sesi (DELETE).
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    let msg: JsonRpcRequest;
    try {
      msg = (await req.json()) as JsonRpcRequest;
    } catch {
      return error(null, -32700, "Parse error", 400);
    }
    if (!msg || typeof msg !== "object" || Array.isArray(msg) || typeof msg.method !== "string") {
      return error(null, -32600, "Invalid request", 400);
    }
    // Notifikasi (tanpa id): cukup diterima.
    if (msg.id === undefined) return new Response(null, { status: 202 });

    switch (msg.method) {
      case "initialize": {
        const requested = msg.params?.protocolVersion;
        return reply(msg.id, {
          protocolVersion: typeof requested === "string" ? requested : "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: AGENT_MCP_NAME, version: "1.0.0" },
          instructions:
            "Dev server tools for the project KCG Code is previewing. Prefer these over starting servers in a shell.",
        });
      }
      case "ping":
        return reply(msg.id, {});
      case "tools/list":
        return reply(msg.id, { tools: TOOLS });
      case "tools/call": {
        const name = msg.params?.name;
        const args = msg.params?.arguments;
        if (typeof name !== "string") return error(msg.id, -32602, "Missing tool name");
        const out = await callTool(
          projectId,
          name,
          args && typeof args === "object" ? (args as Record<string, unknown>) : {},
        );
        return reply(msg.id, { content: [{ type: "text", text: out.text }], isError: out.isError });
      }
      default:
        return error(msg.id, -32601, `Method not found: ${msg.method}`);
    }
  }

  return { tokenFor, handle };
}
