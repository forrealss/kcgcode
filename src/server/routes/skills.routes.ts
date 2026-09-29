/**
 * Tabel rute API katalog & instalasi skill (skills.sh).
 *
 * - `GET  /api/skills/search?q=` — cari skill di skills.sh (proxy + cache).
 * - `GET  /api/skills/audit?source=&skill=` — hasil audit keamanan skill.
 * - `POST /api/projects/:id/skills/install` `{ source, skill }` — mulai job
 *   instalasi (202 + job). CLI `skills` berjalan di latar.
 * - `GET  /api/skills/installs` — job berjalan & yang baru selesai.
 * - `GET  /api/skills/installs/:jobId?from=<n>` — status job + baris log
 *   mulai indeks `n` (polling bertahap untuk output live).
 * - `POST /api/skills/installs/:jobId/cancel` — batalkan job berjalan.
 *
 * Daftar skill terpasang tetap lewat `GET /api/projects/:id/skills`
 * (dibaca dari opencode) di `projects.routes.ts`.
 */
import type { BunRequest } from "bun";
import { errorStatus, json, readJson, serverError } from "./helpers";
import type { ApiRouteContext } from "./types";

export function skillsRoutes(ctx: ApiRouteContext) {
  const { projectManager, skillsRegistry, skillInstalls } = ctx;
  return {
    "/api/skills/search": {
      GET: async (req: Request) => {
        try {
          const q = new URL(req.url).searchParams.get("q") ?? "";
          const res = await skillsRegistry.search(q);
          if (!res.ok) return json({ error: res.error }, errorStatus(res.error));
          return json({ skills: res.data });
        } catch (e) {
          return serverError(e);
        }
      },
    },

    "/api/skills/audit": {
      GET: async (req: Request) => {
        try {
          const params = new URL(req.url).searchParams;
          const res = await skillsRegistry.audit(
            params.get("source") ?? "",
            params.get("skill") ?? "",
          );
          if (!res.ok) return json({ error: res.error }, errorStatus(res.error));
          return json({ audit: res.data });
        } catch (e) {
          return serverError(e);
        }
      },
    },

    "/api/projects/:id/skills/install": {
      POST: async (req: BunRequest<"/api/projects/:id/skills/install">) => {
        try {
          const body = await readJson(req);
          if (!body.ok) return json({ error: "INVALID_JSON" }, 400);
          const { source, skill } = (body.data ?? {}) as { source?: unknown; skill?: unknown };
          if (typeof source !== "string" || typeof skill !== "string") {
            return json({ error: "INVALID_SKILL_ID" }, 400);
          }
          const project = projectManager.getProject(req.params.id);
          if (!project.ok) return json({ error: project.error }, errorStatus(project.error));

          const job = skillInstalls.start({
            projectId: project.data.id,
            projectName: project.data.name,
            projectPath: project.data.path,
            source,
            skillId: skill,
          });
          if (!job.ok) return json({ error: job.error }, errorStatus(job.error));
          return json({ job: job.data }, 202);
        } catch (e) {
          return serverError(e);
        }
      },
    },

    "/api/skills/installs": {
      GET: () => {
        try {
          return json({ jobs: skillInstalls.list() });
        } catch (e) {
          return serverError(e);
        }
      },
    },

    "/api/skills/installs/:jobId": {
      GET: (req: BunRequest<"/api/skills/installs/:jobId">) => {
        try {
          const from = Number(new URL(req.url).searchParams.get("from") ?? "0");
          const log = skillInstalls.get(req.params.jobId, Number.isFinite(from) ? from : 0);
          if (!log) return json({ error: "INSTALL_JOB_NOT_FOUND" }, 404);
          return json(log);
        } catch (e) {
          return serverError(e);
        }
      },
    },

    "/api/skills/installs/:jobId/cancel": {
      POST: (req: BunRequest<"/api/skills/installs/:jobId/cancel">) => {
        try {
          const log = skillInstalls.get(req.params.jobId);
          if (!log) return json({ error: "INSTALL_JOB_NOT_FOUND" }, 404);
          if (!skillInstalls.cancel(req.params.jobId)) {
            return json({ error: "INSTALL_JOB_NOT_RUNNING" }, 409);
          }
          return json({ ok: true }, 202);
        } catch (e) {
          return serverError(e);
        }
      },
    },
  };
}
