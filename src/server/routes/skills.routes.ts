/**
 * Tabel rute API katalog & instalasi skill (skills.sh).
 *
 * - `GET  /api/skills/search?q=` — cari skill di skills.sh (proxy + cache).
 * - `GET  /api/skills/audit?source=&skill=` — hasil audit keamanan skill.
 * - `POST /api/projects/:id/skills/install` `{ source, skill, agents? }` —
 *   mulai job instalasi (202 + job) untuk satu atau beberapa agent
 *   (`opencode` default, `claude-code`). CLI `skills` berjalan di latar.
 * - `GET  /api/skills/installs` — job berjalan & yang baru selesai.
 * - `GET  /api/skills/installs/:jobId?from=<n>` — status job + baris log
 *   mulai indeks `n` (polling bertahap untuk output live).
 * - `POST /api/skills/installs/:jobId/cancel` — batalkan job berjalan.
 *
 * Daftar skill terpasang tetap lewat `GET /api/projects/:id/skills?agent=`
 * di `projects.routes.ts`.
 */
import type { BunRequest } from "bun";
import type { AgentType } from "../../types";
import { errorResponse, json, queryInt, readObject, respond, withProject } from "./helpers";
import type { ApiRouteContext } from "./types";

const INSTALL_AGENTS: readonly AgentType[] = ["opencode", "claude-code"];

/** `agents` body -> daftar unik terurut; `null` bila tidak valid / kosong. */
function parseInstallAgents(raw: unknown): AgentType[] | null {
  if (raw === undefined) return ["opencode"];
  if (!Array.isArray(raw) || raw.length === 0) return null;
  if (!raw.every((a) => INSTALL_AGENTS.includes(a as AgentType))) return null;
  return INSTALL_AGENTS.filter((a) => raw.includes(a));
}

export function skillsRoutes(ctx: ApiRouteContext) {
  const { skillsRegistry, skillInstalls } = ctx;
  return {
    "/api/skills/search": {
      GET: async (req: Request) => {
        const q = new URL(req.url).searchParams.get("q") ?? "";
        return respond(await skillsRegistry.search(q), (skills) => ({ skills }));
      },
    },

    "/api/skills/audit": {
      GET: async (req: Request) => {
        const params = new URL(req.url).searchParams;
        const res = await skillsRegistry.audit(
          params.get("source") ?? "",
          params.get("skill") ?? "",
        );
        return respond(res, (audit) => ({ audit }));
      },
    },

    "/api/projects/:id/skills/install": {
      POST: async (req: BunRequest<"/api/projects/:id/skills/install">) => {
        const b = await readObject(req);
        if (!b) return errorResponse("INVALID_JSON");
        const { source, skill, agents } = b;
        if (typeof source !== "string" || typeof skill !== "string") {
          return errorResponse("INVALID_SKILL_ID");
        }
        const agentTypes = parseInstallAgents(agents);
        if (agentTypes === null) return errorResponse("UNSUPPORTED_AGENT_TYPE");
        return withProject(ctx, req.params.id, (project) => {
          const job = skillInstalls.start({
            projectId: project.id,
            projectName: project.name,
            projectPath: project.path,
            source,
            skillId: skill,
            agentTypes,
          });
          return respond(job, (j) => ({ job: j }), 202);
        });
      },
    },

    "/api/skills/installs": {
      GET: () => json({ jobs: skillInstalls.list() }),
    },

    "/api/skills/installs/:jobId": {
      GET: (req: BunRequest<"/api/skills/installs/:jobId">) => {
        const log = skillInstalls.get(req.params.jobId, queryInt(req, "from"));
        if (!log) return errorResponse("INSTALL_JOB_NOT_FOUND");
        return json(log);
      },
    },

    "/api/skills/installs/:jobId/cancel": {
      POST: (req: BunRequest<"/api/skills/installs/:jobId/cancel">) => {
        if (!skillInstalls.get(req.params.jobId)) return errorResponse("INSTALL_JOB_NOT_FOUND");
        if (!skillInstalls.cancel(req.params.jobId))
          return errorResponse("INSTALL_JOB_NOT_RUNNING");
        return json({ ok: true }, 202);
      },
    },
  };
}
