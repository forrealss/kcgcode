/**
 * Tabel rute info aplikasi.
 *
 * - `GET /api/meta`   `{ version, update }` — dipakai Settings -> About & sidebar.
 *
 * Dijaga `guardRoutes` seperti rute lain: versi bukan rahasia, tapi tidak
 * perlu diekspos ke pengunjung yang belum membuka kunci.
 */
import { readAppInfo } from "../services/app-info";
import type { UpdateChecker } from "../services/update-check";
import { json, serverError } from "./helpers";

export function metaRoutes(updates?: UpdateChecker) {
  return {
    "/api/meta": {
      GET: async () => {
        try {
          return json(await readAppInfo(updates));
        } catch (e) {
          return serverError(e);
        }
      },
    },
  };
}
