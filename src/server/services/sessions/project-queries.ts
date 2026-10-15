/**
 * Operasi tingkat Project yang diteruskan ke client agent (dibuat bila
 * perlu): daftar model/agent/MCP/skill/command, kontrol MCP, cari file, dan
 * capability agent.
 */
import type { AgentType } from "../../../types";
import type { AgentClient } from "../../agents/types";
import type { Result } from "../../result";
import type { SessionManager } from "./types";

type ProjectQueries = Pick<
  SessionManager,
  | "listModels"
  | "listAgents"
  | "listMcp"
  | "setMcpEnabled"
  | "reconnectMcp"
  | "listSkills"
  | "listCommands"
  | "findFiles"
  | "listCapabilities"
>;

/**
 * `projectClient` = client agent Project (dibuat bila perlu). Default tipe
 * agent `opencode` untuk pemanggil lama tanpa `agentType`.
 */
export function createProjectQueries(
  projectClient: (projectId: string, agentType: AgentType) => Promise<Result<AgentClient>>,
): ProjectQueries {
  /** Jalankan `fn` pada client Project; gagal membuat client -> error-nya. */
  async function withClient<T>(
    projectId: string,
    agentType: AgentType,
    fn: (client: AgentClient) => Promise<Result<T>> | Result<T>,
  ): Promise<Result<T>> {
    const client = await projectClient(projectId, agentType);
    return client.ok ? fn(client.data) : client;
  }

  return {
    /** Daftar model yang tersedia untuk Project (config agent di direktori Project). */
    listModels: (projectId, agentType = "opencode") =>
      withClient(projectId, agentType, (c) => c.model.list()),

    /** Daftar agent (mode) untuk Project — agent kustom user ikut masuk. */
    listAgents: (projectId, agentType = "opencode") =>
      withClient(projectId, agentType, (c) => c.agent.list()),

    listMcp: (projectId, agentType = "opencode") =>
      withClient(projectId, agentType, (c) => c.mcp.list()),

    async setMcpEnabled(projectId, name, enabled, agentType = "opencode") {
      if (name.trim() === "") return { ok: false, error: "INVALID_MCP_SERVER" };
      const client = await projectClient(projectId, agentType);
      return client.ok ? client.data.mcp.setEnabled(name, enabled) : client;
    },

    async reconnectMcp(projectId, name, agentType = "opencode") {
      if (name.trim() === "") return { ok: false, error: "INVALID_MCP_SERVER" };
      const client = await projectClient(projectId, agentType);
      return client.ok ? client.data.mcp.reconnect(name) : client;
    },

    /**
     * Skill yang terdaftar untuk Project. Skill di dalam folder Project
     * ditandai `project` sehingga UI dapat membedakannya dari skill global.
     */
    listSkills: (projectId, agentType = "opencode") =>
      withClient(projectId, agentType, (c) => c.skill.list()),

    listCommands: (projectId, agentType = "opencode") =>
      withClient(projectId, agentType, (c) => c.command.list()),

    /**
     * Cari file di Project untuk autocomplete `@file` — index pencarian milik
     * agent. `query` kosong juga valid (mengembalikan daftar awal).
     */
    findFiles: (projectId, query, agentType = "opencode") =>
      withClient(projectId, agentType, (c) => c.file.find(query)),

    /** Fitur khas agent Project (client dibuat bila perlu). */
    listCapabilities: (projectId, agentType = "opencode") =>
      withClient(projectId, agentType, (c) => ({
        ok: true,
        data: { permissionModes: c.capabilities.permissionModes },
      })),
  };
}
