/**
 * Tabel rute API perubahan per turn & viewer file Project.
 *
 * - `GET /api/sessions/:id/changes`                         ringkasan per turn
 * - `GET /api/sessions/:id/changes/:diffId/diff?path=<rel>` unified diff 1 file
 * - `GET /api/projects/:id/file?path=<rel>`                 isi file (JSON)
 *   (`&raw=1` untuk gambar — bytes mentah, CSP sandbox)
 *
 * Seluruhnya dijaga `guardRoutes` (sesi + Origin). Baca-saja.
 */
import type { BunRequest } from "bun";
import { readProjectFile, readProjectImage } from "../services/project-files";
import { errorStatus, json, serverError } from "./helpers";
import type { ApiRouteContext } from "./types";

/**
 * `protectedDirs`: folder/file kcgcode yang tak boleh dibaca walau berada di
 * dalam Project (folder data, lampiran, file config).
 */
export function changesRoutes(ctx: ApiRouteContext, opts: { protectedDirs: string[] }) {
  const { sessionManager, projectManager, turnDiffs } = ctx;

  return {
    "/api/sessions/:id/changes": {
      GET: (req: BunRequest<"/api/sessions/:id/changes">) => {
        try {
          const s = sessionManager.getSession(req.params.id);
          if (!s.ok) return json({ error: "SESSION_NOT_FOUND" }, errorStatus("SESSION_NOT_FOUND"));
          return json({ diffs: turnDiffs.list(s.data.id) });
        } catch (e) {
          return serverError(e);
        }
      },
    },

    "/api/sessions/:id/changes/:diffId/diff": {
      GET: async (req: BunRequest<"/api/sessions/:id/changes/:diffId/diff">) => {
        try {
          const file = new URL(req.url).searchParams.get("path") ?? "";
          const res = await turnDiffs.fileDiff(req.params.id, req.params.diffId, file);
          if (!res.ok) return json({ error: res.error }, errorStatus(res.error));
          return json({ diff: res.data });
        } catch (e) {
          return serverError(e);
        }
      },
    },

    "/api/projects/:id/file": {
      GET: (req: BunRequest<"/api/projects/:id/file">) => {
        try {
          const p = projectManager.getProject(req.params.id);
          if (!p.ok) return json({ error: p.error }, errorStatus(p.error));
          const url = new URL(req.url);
          const rel = url.searchParams.get("path") ?? "";
          if (url.searchParams.get("raw") === "1") {
            const img = readProjectImage(p.data.path, rel, opts.protectedDirs);
            if (!img.ok) return json({ error: img.error }, errorStatus(img.error));
            return new Response(img.data.bytes, {
              headers: {
                "content-type": img.data.mime,
                "cache-control": "no-store",
                // SVG dibuka langsung tidak boleh menjalankan script di origin app.
                "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
                "x-content-type-options": "nosniff",
              },
            });
          }
          const res = readProjectFile(p.data.path, rel, opts.protectedDirs);
          if (!res.ok) return json({ error: res.error }, errorStatus(res.error));
          return json({ file: res.data });
        } catch (e) {
          return serverError(e);
        }
      },
    },
  };
}
