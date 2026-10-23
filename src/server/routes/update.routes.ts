/**
 * Tabel rute update KCG Code dari app (Settings -> About).
 *
 * - `GET  /api/update`               status job instalasi + Session `running`
 * - `POST /api/update`               `{ version }` — mulai pasang (202); harus
 *   sama dengan versi `latest` yang sedang ditawarkan (`/api/meta`)
 * - `GET  /api/update/logs?from=<n>` output installer mulai indeks n
 *
 * Dijaga `guardRoutes` (sesi + Origin) seperti rute lain.
 */
import { errorResponse, json, queryInt, readObject } from "./helpers";
import type { ApiRouteContext } from "./types";

export function updateRoutes(ctx: ApiRouteContext) {
  const { selfUpdate } = ctx;
  return {
    "/api/update": {
      GET: async () => json(await selfUpdate.status()),
      POST: async (req: Request) => {
        const b = await readObject(req);
        if (!b) return errorResponse("INVALID_JSON");
        if (typeof b.version !== "string") return errorResponse("UPDATE_NOT_AVAILABLE");
        const res = await selfUpdate.start(b.version);
        if (!res.ok) return errorResponse(res.error);
        return json(res.data, 202);
      },
    },

    "/api/update/logs": {
      GET: (req: Request) => json(selfUpdate.logs(queryInt(req, "from"))),
    },
  };
}
