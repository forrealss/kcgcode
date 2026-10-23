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
import {
  displayPath,
  projectsOutside,
  validateWorkspaceRoot,
  type WorkspaceInfo,
  writeSandboxRoot,
} from "../services/workspace";
import { clientIp } from "./auth-guard";
import { errorResponse, json, readObject } from "./helpers";
import type { ApiRouteContext } from "./types";

export function workspaceRoutes(ctx: ApiRouteContext) {
  const { projectManager, auth, configPath, home } = ctx;

  const info = (): WorkspaceInfo => {
    const root = projectManager.getSandboxRoot();
    const all = projectManager.listProjects();
    return {
      root,
      display: displayPath(root, home),
      projectCount: all.length - projectsOutside(root, all).length,
      configPath,
    };
  };

  return {
    "/api/workspace": {
      GET: () => json({ workspace: info() }),
      PUT: async (req: Request, server: Server<unknown>) => {
        const b = await readObject(req);
        if (!b) return errorResponse("INVALID_JSON");

        // 1. Konfirmasi sandi (bila dikunci) SEBELUM menyentuh filesystem —
        //    pesan validasi path tidak boleh jadi oracle tanpa sandi.
        if (auth.isProtected()) {
          const check = await auth.internal.checkCurrentSecret(
            typeof b.current === "string" ? b.current : "",
            clientIp(req, server),
          );
          if (!check.ok) return errorResponse(check.error ?? "CURRENT_SECRET_INVALID");
        }

        // 2. Validasi path kandidat.
        const v = validateWorkspaceRoot(b.path, {
          create: b.create === true,
          protectedDirs: ctx.protectedPaths.dirs,
          home,
        });
        if (!v.ok) return errorResponse(v.error);
        const root = v.data.root;

        // 3. Project terdaftar di luar root baru -> tolak (dengan daftarnya).
        const outside = projectsOutside(root, projectManager.listProjects());
        if (outside.length > 0) {
          return errorResponse("WORKSPACE_PROJECTS_OUTSIDE", {
            projects: outside.map((p) => ({ id: p.id, name: p.name, path: p.path })),
          });
        }

        // 4. Buat folder (opsional), simpan ke config, terapkan.
        if (v.data.willCreate) {
          try {
            mkdirSync(root);
          } catch {
            return errorResponse("WORKSPACE_CREATE_FAILED");
          }
        }
        const saved = writeSandboxRoot(configPath, root);
        if (!saved.ok) return errorResponse(saved.error);
        projectManager.setSandboxRoot(root);
        ctx.notifyDataChanged();
        return json({ workspace: info() });
      },
    },
  };
}
