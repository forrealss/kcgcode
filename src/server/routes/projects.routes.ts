/**
 * Tabel rute API Project & Folder_Browser (Requirement 10).
 *
 * `/api/projects` (GET daftar / POST buat), `/api/fs` (GET list direktori
 * untuk Folder_Browser), dan `/api/projects/:id/models` (GET model yang
 * tersedia pada server headless Project). Dipasang composition root
 * (`app.ts`) bersama tabel rute lain — pola kcgrouter (`*.routes.ts`).
 */
import type { BunRequest } from "bun";
import { errorStatus, json, readJson, serverError } from "./helpers";
import type { ApiRouteContext } from "./types";

export function projectsRoutes(ctx: ApiRouteContext) {
  const { projectManager, sessionManager, guard } = ctx;
  return {
    // ---- Project & Folder_Browser (Requirement 10) ----
    "/api/projects": {
      GET: guard(() => {
        try {
          return json({ projects: projectManager.listProjects() });
        } catch (e) {
          return serverError(e);
        }
      }),
      POST: guard(async (req) => {
        try {
          const body = await readJson(req);
          if (!body.ok) return json({ error: "INVALID_JSON" }, 400);
          const { name, path } = body.data as { name?: unknown; path?: unknown };
          const res = projectManager.createProject(
            typeof name === "string" ? name : "",
            typeof path === "string" ? path : "",
          );
          if (!res.ok) return json({ error: res.error }, errorStatus(res.error));
          return json({ project: res.data }, 201);
        } catch (e) {
          return serverError(e);
        }
      }),
    },

    "/api/fs": {
      GET: guard((req) => {
        try {
          const url = new URL(req.url);
          const res = projectManager.listDirectory(url.searchParams.get("path") ?? "");
          if (!res.ok) return json({ error: res.error }, errorStatus(res.error));
          return json({ entries: res.data.entries });
        } catch (e) {
          return serverError(e);
        }
      }),
    },

    // ---- Daftar model yang tersedia pada server headless Project ----
    "/api/projects/:id/models": {
      GET: guard(async (req: BunRequest<"/api/projects/:id/models">) => {
        try {
          const res = await sessionManager.listModels(req.params.id);
          if (!res.ok) return json({ error: res.error }, errorStatus(res.error));
          return json({ models: res.data });
        } catch (e) {
          return serverError(e);
        }
      }),
    },
  };
}
