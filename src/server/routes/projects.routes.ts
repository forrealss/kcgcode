/**
 * Tabel rute API Project & Folder_Browser (Requirement 10).
 *
 * `/api/projects` (GET daftar / POST buat), `/api/projects/:id` (PATCH ubah
 * custom instruction, DELETE hapus
 * pendaftaran Project beserta seluruh Session-nya), `/api/fs` (GET list
 * direktori untuk Folder_Browser), `/api/projects/:id/models` (GET model
 * yang tersedia pada server headless Project), daftar agent / MCP / skill /
 * slash command Project, serta kendali MCP (aktif/nonaktif, reconnect) dan
 * reload skill di agent, serta impor Session Claude Desktop / CLI
 * (`/api/projects/:id/external-sessions`). Dipasang composition root
 * (`app.ts`) bersama tabel rute lain — pola kcgcode (`*.routes.ts`).
 */
import type { BunRequest } from "bun";
import type { AgentType, McpServerInfo } from "../../types";
import type { Result, SimpleResult } from "../result";
import { errorResponse, json, readObject, respond } from "./helpers";
import type { ApiRouteContext } from "./types";

/**
 * Backend yang ditanyakan lewat `?agent=` (default opencode) — daftar model &
 * agent berbeda antara opencode dan Claude Code.
 */
function agentTypeParam(req: Request): AgentType {
  const agent = new URL(req.url).searchParams.get("agent");
  return agent === "claude-code" ? "claude-code" : "opencode";
}

/**
 * Balasan aksi MCP: daftar terbaru (bila terbaca) + error aksi bila gagal.
 * Status gagal tetap membawa `mcp` agar UI memperbarui baris servernya.
 */
function mcpActionResponse(res: SimpleResult, list: Result<McpServerInfo[]>): Response {
  const mcp = list.ok ? { mcp: list.data } : {};
  if (!res.ok) return errorResponse(res.error ?? "ERROR", mcp);
  return json({ ok: true, ...mcp });
}

export function projectsRoutes(ctx: ApiRouteContext) {
  const { projectManager, sessionManager, notifyDataChanged } = ctx;
  return {
    // ---- Project & Folder_Browser (Requirement 10) ----
    "/api/projects": {
      GET: () => json({ projects: projectManager.listProjects() }),
      POST: async (req: Request) => {
        const b = await readObject(req);
        if (!b) return errorResponse("INVALID_JSON");
        const res = projectManager.createProject(
          typeof b.name === "string" ? b.name : "",
          typeof b.path === "string" ? b.path : "",
        );
        if (!res.ok) return errorResponse(res.error);
        notifyDataChanged();
        return json({ project: res.data }, 201);
      },
    },

    "/api/projects/:id": {
      /**
       * Perbarui Project. Saat ini hanya `instructions` (custom instruction
       * yang dikirim sebagai `system` di setiap prompt). String kosong =
       * hapus instruksi.
       */
      PATCH: async (req: BunRequest<"/api/projects/:id">) => {
        const b = await readObject(req);
        if (!b) return errorResponse("INVALID_JSON");
        const { instructions } = b;
        if (instructions !== null && typeof instructions !== "string") {
          return errorResponse("INVALID_INSTRUCTIONS");
        }
        const res = projectManager.updateInstructions(req.params.id, instructions ?? "");
        return respond(res, (project) => ({ project }));
      },
      /**
       * Hapus pendaftaran Project. Seluruh Session miliknya dihapus lebih dulu
       * (`releaseProject`) sehingga sesi remote opencode dan lampiran gambar
       * ikut bersih, lalu server headless Project dihentikan. Direktori kerja
       * di filesystem TIDAK disentuh — Project hanyalah referensi ke folder.
       *
       * Kegagalan pembersihan Session -> error diteruskan, baris Project tetap
       * ada supaya operasi bisa dicoba ulang tanpa meninggalkan sesi yatim.
       */
      DELETE: async (req: BunRequest<"/api/projects/:id">) => {
        const released = await sessionManager.releaseProject(req.params.id);
        if (!released.ok) return errorResponse(released.error ?? "ERROR");
        const res = projectManager.deleteProject(req.params.id);
        if (!res.ok) return errorResponse(res.error ?? "ERROR");
        notifyDataChanged();
        return json({ ok: true });
      },
    },

    "/api/fs": {
      GET: (req: Request) => {
        const res = projectManager.listDirectory(new URL(req.url).searchParams.get("path") ?? "");
        return respond(res, (d) => ({ entries: d.entries }));
      },
    },

    // ---- Daftar model yang tersedia pada server headless Project ----
    "/api/projects/:id/models": {
      GET: async (req: BunRequest<"/api/projects/:id/models">) =>
        respond(await sessionManager.listModels(req.params.id, agentTypeParam(req)), (models) => ({
          models,
        })),
    },

    // ---- MCP server & skill Project (panel samping halaman Project) ----
    "/api/projects/:id/mcp": {
      GET: async (req: BunRequest<"/api/projects/:id/mcp">) =>
        respond(await sessionManager.listMcp(req.params.id, agentTypeParam(req)), (mcp) => ({
          mcp,
        })),
    },

    /**
     * Aktifkan / nonaktifkan MCP server (`{ name, enabled }`). Nama di body,
     * bukan di path: nama server bebas (spasi, `:`, `/`). Balasan = daftar MCP
     * terbaru agent itu — juga saat gagal (mis. diaktifkan tapi tidak bisa
     * tersambung), agar UI langsung menampilkan statusnya.
     */
    "/api/projects/:id/mcp/toggle": {
      POST: async (req: BunRequest<"/api/projects/:id/mcp/toggle">) => {
        const b = await readObject(req);
        if (!b) return errorResponse("INVALID_JSON");
        const { name, enabled } = b;
        if (typeof name !== "string" || typeof enabled !== "boolean") {
          return errorResponse("INVALID_MCP_SERVER");
        }
        const agent = agentTypeParam(req);
        const res = await sessionManager.setMcpEnabled(req.params.id, name, enabled, agent);
        return mcpActionResponse(res, await sessionManager.listMcp(req.params.id, agent));
      },
    },

    /** Sambungkan ulang MCP server (`{ name }`); balasan seperti `toggle`. */
    "/api/projects/:id/mcp/reconnect": {
      POST: async (req: BunRequest<"/api/projects/:id/mcp/reconnect">) => {
        const b = await readObject(req);
        if (!b) return errorResponse("INVALID_JSON");
        if (typeof b.name !== "string") return errorResponse("INVALID_MCP_SERVER");
        const agent = agentTypeParam(req);
        const res = await sessionManager.reconnectMcp(req.params.id, b.name, agent);
        return mcpActionResponse(res, await sessionManager.listMcp(req.params.id, agent));
      },
    },

    "/api/projects/:id/skills": {
      GET: async (req: BunRequest<"/api/projects/:id/skills">) =>
        respond(await sessionManager.listSkills(req.params.id, agentTypeParam(req)), (skills) => ({
          skills,
        })),
    },

    /**
     * Muat ulang skill di agent tanpa restart (Claude Code `reloadSkills` di
     * proses yang hidup; opencode me-reload instance — ditunda sampai turn
     * di Project selesai, `refreshed: false`).
     */
    "/api/projects/:id/skills/reload": {
      POST: async (req: BunRequest<"/api/projects/:id/skills/reload">) =>
        respond(await sessionManager.refreshSkills(req.params.id, agentTypeParam(req)), (d) => d),
    },

    // ---- Slash command (autocomplete `/` di composer) ----
    "/api/projects/:id/commands": {
      GET: async (req: BunRequest<"/api/projects/:id/commands">) =>
        respond(
          await sessionManager.listCommands(req.params.id, agentTypeParam(req)),
          (commands) => ({ commands }),
        ),
    },

    // ---- Fitur khas agent (mis. permission mode Claude Code) ----
    "/api/projects/:id/capabilities": {
      GET: async (req: BunRequest<"/api/projects/:id/capabilities">) =>
        respond(
          await sessionManager.listCapabilities(req.params.id, agentTypeParam(req)),
          (capabilities) => ({ capabilities }),
        ),
    },

    // ---- Agent (mode) opencode: build/plan + agent kustom user ----
    "/api/projects/:id/agents": {
      GET: async (req: BunRequest<"/api/projects/:id/agents">) =>
        respond(await sessionManager.listAgents(req.params.id, agentTypeParam(req)), (agents) => ({
          agents,
        })),
    },

    // ---- Session agent buatan Claude Desktop / CLI / opencode untuk direktori Project ----
    "/api/projects/:id/external-sessions": {
      /** Kandidat impor (`?agent=`, default Claude Code). */
      GET: async (req: BunRequest<"/api/projects/:id/external-sessions">) => {
        const agent = new URL(req.url).searchParams.get("agent");
        const res = await sessionManager.listExternalSessions(
          req.params.id,
          (agent ?? "claude-code") as AgentType,
        );
        return respond(res, (sessions) => ({ sessions }));
      },
      /**
       * Impor satu Session: body `{ id, agentType?, fork? }`. Session yang
       * masih terbuka di aplikasi lain -> 409 `EXTERNAL_SESSION_OPEN` kecuali
       * `fork: true` (lanjut di salinan).
       */
      POST: async (req: BunRequest<"/api/projects/:id/external-sessions">) => {
        const b = await readObject(req);
        if (!b) return errorResponse("INVALID_JSON");
        const { id, agentType, fork } = b;
        if (typeof id !== "string" || id.trim() === "") return errorResponse("SESSION_NOT_FOUND");
        const res = await sessionManager.importExternalSession({
          projectId: req.params.id,
          agentType: (typeof agentType === "string" ? agentType : "claude-code") as AgentType,
          externalId: id.trim(),
          fork: fork === true,
        });
        if (!res.ok) return errorResponse(res.error);
        notifyDataChanged();
        return json({ session: res.session }, 201);
      },
    },
  };
}
