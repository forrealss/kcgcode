/**
 * Tabel rute API Workspace (Sandbox_Root) — Settings -> Workspace.
 *
 * - `GET /api/workspace`   root aktif + jumlah Project di dalamnya
 * - `PUT /api/workspace`   `{ path, create?, current? }` ganti root
 *
 * Keduanya dijaga `guardRoutes` (sesi + Origin). Mengganti root adalah
 * perubahan batas keamanan, jadi saat app dikunci `current` (PIN/password)
 * wajib benar — dengan rate limit yang sama seperti login.
 */
import { mkdirSync } from "node:fs";
import type { Server } from "bun";
import type { AuthService } from "../services/auth";
import {
  displayPath,
  projectsOutside,
  validateWorkspaceRoot,
  type WorkspaceInfo,
  writeSandboxRoot,
} from "../services/workspace";
import { clientIp } from "./auth-guard";
import { errorStatus, json, readJson, serverError } from "./helpers";
import type { ApiRouteContext } from "./types";

export interface WorkspaceRouteDeps {
  auth: AuthService;
  configPath: string;
  /** Folder milik KCG Code yang tak boleh tumpang tindih dengan workspace. */
  protectedDirs: string[];
  /** Home pengguna (`~`) — diinjeksi agar test tidak menyentuh home asli. */
  home?: string;
}

function rateLimitedResponse(code: string): Response | null {
  if (!code.startsWith("AUTH_RATE_LIMITED:")) return null;
  const wait = Number(code.slice("AUTH_RATE_LIMITED:".length)) || 30;
  return new Response(JSON.stringify({ error: "AUTH_RATE_LIMITED", retryAfterSec: wait }), {
    status: 429,
    headers: { "content-type": "application/json", "retry-after": String(wait) },
  });
}

export function workspaceRoutes(ctx: ApiRouteContext, deps: WorkspaceRouteDeps) {
  const { projectManager } = ctx;

  const info = (): WorkspaceInfo => {
    const root = projectManager.getSandboxRoot();
    const all = projectManager.listProjects();
    return {
      root,
      display: displayPath(root, deps.home),
      projectCount: all.length - projectsOutside(root, all).length,
      configPath: deps.configPath,
    };
  };

  return {
    "/api/workspace": {
      GET: () => {
        try {
          return json({ workspace: info() });
        } catch (e) {
          return serverError(e);
        }
      },
      PUT: async (req: Request, server: Server<unknown>) => {
        try {
          const body = await readJson(req);
          if (!body.ok || body.data === null || typeof body.data !== "object") {
            return json({ error: "INVALID_JSON" }, 400);
          }
          const b = body.data as { path?: unknown; create?: unknown; current?: unknown };

          // 1. Konfirmasi sandi (bila dikunci) SEBELUM menyentuh filesystem —
          //    pesan validasi path tidak boleh jadi oracle tanpa sandi.
          if (deps.auth.isProtected()) {
            const check = await deps.auth.internal.checkCurrentSecret(
              typeof b.current === "string" ? b.current : "",
              clientIp(req, server),
            );
            if (!check.ok) {
              const code = check.error ?? "CURRENT_SECRET_INVALID";
              return rateLimitedResponse(code) ?? json({ error: code }, errorStatus(code));
            }
          }

          // 2. Validasi path kandidat.
          const v = validateWorkspaceRoot(b.path, {
            create: b.create === true,
            protectedDirs: deps.protectedDirs,
            home: deps.home,
          });
          if (!v.ok) return json({ error: v.error }, errorStatus(v.error));
          const root = v.data.root;

          // 3. Project terdaftar di luar root baru -> tolak (dengan daftarnya).
          const outside = projectsOutside(root, projectManager.listProjects());
          if (outside.length > 0) {
            return json(
              {
                error: "WORKSPACE_PROJECTS_OUTSIDE",
                projects: outside.map((p) => ({ id: p.id, name: p.name, path: p.path })),
              },
              409,
            );
          }

          // 4. Buat folder (opsional), simpan ke config, terapkan.
          if (v.data.willCreate) {
            try {
              mkdirSync(root);
            } catch {
              return json({ error: "WORKSPACE_CREATE_FAILED" }, 500);
            }
          }
          const saved = writeSandboxRoot(deps.configPath, root);
          if (!saved.ok) return json({ error: saved.error }, 500);
          projectManager.setSandboxRoot(root);
          ctx.notifyDataChanged();
          return json({ workspace: info() });
        } catch (e) {
          return serverError(e);
        }
      },
    },
  };
}
