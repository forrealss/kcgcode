/**
 * Tabel rute API Web Push (semua wajib login — dijaga `guardRoutes`):
 *
 * - `GET    /api/push/vapid-key`          `{ publicKey }` untuk `pushManager.subscribe`
 * - `GET    /api/push/devices`            perangkat yang menerima notifikasi
 * - `POST   /api/push/devices`            `{ endpoint, keys: { p256dh, auth }, refreshOnly? }`
 *                                         -> `{ device }` (upsert). `refreshOnly` = sinkron
 *                                         saat app dibuka: perangkat yang sudah dihapus
 *                                         tidak didaftarkan lagi (`device: null`).
 * - `DELETE /api/push/devices/:id`        berhenti mengirim ke perangkat itu
 * - `POST   /api/push/devices/:id/test`   kirim notifikasi uji
 *
 * Endpoint push adalah URL rahasia (siapa pun yang memegangnya + kunci bisa
 * mengirim pesan), jadi tidak pernah dikembalikan ke browser — perangkat
 * dirujuk lewat id (hash endpoint).
 */
import type { BunRequest } from "bun";
import { errorResponse, json, readObject, respond } from "./helpers";
import type { ApiRouteContext } from "./types";

export function pushRoutes(ctx: ApiRouteContext) {
  const { notifications } = ctx;
  return {
    "/api/push/vapid-key": {
      GET: async () => json({ publicKey: await notifications.publicKey() }),
    },

    "/api/push/devices": {
      GET: () => json({ devices: notifications.listDevices() }),
      POST: async (req: Request) => {
        const b = await readObject(req);
        if (!b) return errorResponse("INVALID_JSON");
        const { endpoint, keys, refreshOnly } = b;
        const { p256dh, auth } = (typeof keys === "object" && keys !== null ? keys : {}) as {
          p256dh?: unknown;
          auth?: unknown;
        };
        if (typeof endpoint !== "string") return errorResponse("PUSH_ENDPOINT_INVALID");
        if (typeof p256dh !== "string" || typeof auth !== "string") {
          return errorResponse("PUSH_KEYS_INVALID");
        }
        const res = notifications.subscribe(
          { endpoint, p256dh, auth, userAgent: req.headers.get("user-agent") },
          { refreshOnly: refreshOnly === true },
        );
        return respond(res, (device) => ({ device }));
      },
    },

    "/api/push/devices/:id": {
      DELETE: (req: BunRequest<"/api/push/devices/:id">) => {
        notifications.unsubscribe(req.params.id);
        return json({ ok: true });
      },
    },

    "/api/push/devices/:id/test": {
      POST: async (req: BunRequest<"/api/push/devices/:id/test">) =>
        respond(await notifications.sendTest(req.params.id), () => ({ ok: true })),
    },
  };
}
