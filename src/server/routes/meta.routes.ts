/**
 * Tabel rute info aplikasi.
 *
 * - `GET /api/meta`   `{ version, update }` — dipakai Settings -> About & sidebar.
 *
 * Dijaga `guardRoutes` seperti rute lain: versi bukan rahasia, tapi tidak
 * perlu diekspos ke pengunjung yang belum membuka kunci.
 */
import { readAppInfo } from "../services/app-info";
import { json } from "./helpers";
import type { ApiRouteContext } from "./types";

export function metaRoutes(ctx: ApiRouteContext) {
  const { updates } = ctx;
  return {
    "/api/meta": {
      GET: async () => json(await readAppInfo(updates)),
    },
  };
}
