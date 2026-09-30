/**
 * Tabel rute API Project & Folder_Browser (Requirement 10).
 *
 * `/api/projects` (GET daftar / POST buat), `/api/projects/:id` (PATCH ubah
 * custom instruction, DELETE hapus
 * pendaftaran Project beserta seluruh Session-nya), `/api/fs` (GET list
 * direktori untuk Folder_Browser), dan `/api/projects/:id/models` (GET model
 * yang tersedia pada server headless Project). Dipasang composition root
 * (`app.ts`) bersama tabel rute lain — pola kcgcode (`*.routes.ts`).
 */
import type { BunRequest } from "bun";
import { errorStatus, json, readJson, serverError } from "./helpers";
import type { ApiRouteContext } from "./types";

export function projectsRoutes(ctx: ApiRouteContext) {
  const { projectManager, sessionManager, notifyDataChanged } = ctx;
  return {
    // ---- Project & Folder_Browser (Requirement 10) ----
    "/api/projects": {
      GET: () => {
        try {
          return json({ projects: projectManager.listProjects() });
        } catch (e) {
          return serverError(e);
        }
      },
      POST: async (req: Request) => {
        try {
          const body = await readJson(req);
          if (!body.ok) return json({ error: "INVALID_JSON" }, 400);
          const { name, path } = body.data as { name?: unknown; path?: unknown };
          const res = projectManager.createProject(
            typeof name === "string" ? name : "",
            typeof path === "string" ? path : "",
          );
          if (!res.ok) return json({ error: res.error }, errorStatus(res.error));
          notifyDataChanged();
          return json({ project: res.data }, 201);
        } catch (e) {
          return serverError(e);
        }
      },
    },

    "/api/projects/:id": {
      /**
       * Perbarui Project. Saat ini hanya `instructions` (custom instruction
       * yang dikirim sebagai `system` di setiap prompt). String kosong =
       * hapus instruksi.
       */
      PATCH: async (req: BunRequest<"/api/projects/:id">) => {
        try {
          const body = await readJson(req);
          if (!body.ok) return json({ error: "INVALID_JSON" }, 400);
          const { instructions } = (body.data ?? {}) as { instructions?: unknown };
          if (instructions !== null && typeof instructions !== "string") {
            return json({ error: "INVALID_INSTRUCTIONS" }, 400);
          }
          const res = projectManager.updateInstructions(req.params.id, instructions ?? "");
          if (!res.ok) return json({ error: res.error }, errorStatus(res.error));
          return json({ project: res.data });
        } catch (e) {
          return serverError(e);
        }
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
        try {
          const released = await sessionManager.releaseProject(req.params.id);
          if (!released.ok) {
            return json({ error: released.error ?? "ERROR" }, errorStatus(released.error ?? ""));
          }
          const res = projectManager.deleteProject(req.params.id);
          if (!res.ok) {
            return json({ error: res.error ?? "ERROR" }, errorStatus(res.error ?? ""));
          }
          notifyDataChanged();
          return json({ ok: true });
        } catch (e) {
          return serverError(e);
        }
      },
    },

    "/api/fs": {
      GET: (req: Request) => {
        try {
          const url = new URL(req.url);
          const res = projectManager.listDirectory(url.searchParams.get("path") ?? "");
          if (!res.ok) return json({ error: res.error }, errorStatus(res.error));
          return json({ entries: res.data.entries });
        } catch (e) {
          return serverError(e);
        }
      },
    },

    // ---- Daftar model yang tersedia pada server headless Project ----
    "/api/projects/:id/models": {
      GET: async (req: BunRequest<"/api/projects/:id/models">) => {
        try {
          const res = await sessionManager.listModels(req.params.id);
          if (!res.ok) return json({ error: res.error }, errorStatus(res.error));
          return json({ models: res.data });
        } catch (e) {
          return serverError(e);
        }
      },
    },

    // ---- MCP server & skill Project (panel samping halaman Project) ----
    "/api/projects/:id/mcp": {
      GET: async (req: BunRequest<"/api/projects/:id/mcp">) => {
        try {
          const res = await sessionManager.listMcp(req.params.id);
          if (!res.ok) return json({ error: res.error }, errorStatus(res.error));
          return json({ mcp: res.data });
        } catch (e) {
          return serverError(e);
        }
      },
    },

    "/api/projects/:id/skills": {
      GET: async (req: BunRequest<"/api/projects/:id/skills">) => {
        try {
          const res = await sessionManager.listSkills(req.params.id);
          if (!res.ok) return json({ error: res.error }, errorStatus(res.error));
          return json({ skills: res.data });
        } catch (e) {
          return serverError(e);
        }
      },
    },

    // ---- Agent (mode) opencode: build/plan + agent kustom user ----
    "/api/projects/:id/agents": {
      GET: async (req: BunRequest<"/api/projects/:id/agents">) => {
        try {
          const res = await sessionManager.listAgents(req.params.id);
          if (!res.ok) return json({ error: res.error }, errorStatus(res.error));
          return json({ agents: res.data });
        } catch (e) {
          return serverError(e);
        }
      },
    },
  };
}
