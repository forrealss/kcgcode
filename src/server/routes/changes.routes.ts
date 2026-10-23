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
import { errorResponse, json, respond, withProject } from "./helpers";
import type { ApiRouteContext } from "./types";

/**
 * File kcgcode yang tak boleh dibaca walau berada di dalam Project (DB,
 * lampiran, file config) — `ctx.protectedPaths.files`.
 */
export function changesRoutes(ctx: ApiRouteContext) {
  const { sessionManager, turnDiffs } = ctx;
  const protectedFiles = ctx.protectedPaths.files;

  return {
    "/api/sessions/:id/changes": {
      GET: (req: BunRequest<"/api/sessions/:id/changes">) => {
        const s = sessionManager.getSession(req.params.id);
        if (!s.ok) return errorResponse("SESSION_NOT_FOUND");
        return json({ diffs: turnDiffs.list(s.data.id) });
      },
    },

    "/api/sessions/:id/changes/:diffId/diff": {
      GET: async (req: BunRequest<"/api/sessions/:id/changes/:diffId/diff">) => {
        const file = new URL(req.url).searchParams.get("path") ?? "";
        const res = await turnDiffs.fileDiff(req.params.id, req.params.diffId, file);
        return respond(res, (diff) => ({ diff }));
      },
    },

    "/api/projects/:id/file": {
      GET: (req: BunRequest<"/api/projects/:id/file">) =>
        withProject(ctx, req.params.id, (p) => {
          const url = new URL(req.url);
          const rel = url.searchParams.get("path") ?? "";
          if (url.searchParams.get("raw") === "1") {
            const img = readProjectImage(p.path, rel, protectedFiles);
            if (!img.ok) return errorResponse(img.error);
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
          return respond(readProjectFile(p.path, rel, protectedFiles), (file) => ({ file }));
        }),
    },
  };
}
