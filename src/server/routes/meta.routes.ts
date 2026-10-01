/**
 * Tabel rute info aplikasi.
 *
 * - `GET /api/meta`   `{ version }` — dipakai Settings -> About.
 *
 * Dijaga `guardRoutes` seperti rute lain: versi bukan rahasia, tapi tidak
 * perlu diekspos ke pengunjung yang belum membuka kunci.
 */
import { readAppInfo } from "../services/app-info";
import { json, serverError } from "./helpers";

export function metaRoutes() {
  return {
    "/api/meta": {
      GET: async () => {
        try {
          return json(await readAppInfo());
        } catch (e) {
          return serverError(e);
        }
      },
    },
  };
}
