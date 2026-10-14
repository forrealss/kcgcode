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
import type { NotificationService } from "../services/notifications";
import { errorStatus, json, readJson, serverError } from "./helpers";

export function pushRoutes(notifications: NotificationService) {
  return {
    "/api/push/vapid-key": {
      GET: async () => {
        try {
          return json({ publicKey: await notifications.publicKey() });
        } catch (e) {
          return serverError(e);
        }
      },
    },

    "/api/push/devices": {
      GET: () => {
        try {
          return json({ devices: notifications.listDevices() });
        } catch (e) {
          return serverError(e);
        }
      },
      POST: async (req: Request) => {
        try {
          const body = await readJson(req);
          if (!body.ok || typeof body.data !== "object" || body.data === null) {
            return json({ error: "INVALID_JSON" }, 400);
          }
          const { endpoint, keys, refreshOnly } = body.data as {
            endpoint?: unknown;
            keys?: unknown;
            refreshOnly?: unknown;
          };
          const { p256dh, auth } = (typeof keys === "object" && keys !== null ? keys : {}) as {
            p256dh?: unknown;
            auth?: unknown;
          };
          if (typeof endpoint !== "string") return json({ error: "PUSH_ENDPOINT_INVALID" }, 400);
          if (typeof p256dh !== "string" || typeof auth !== "string") {
            return json({ error: "PUSH_KEYS_INVALID" }, 400);
          }
          const res = notifications.subscribe(
            { endpoint, p256dh, auth, userAgent: req.headers.get("user-agent") },
            { refreshOnly: refreshOnly === true },
          );
          if (!res.ok) return json({ error: res.error }, errorStatus(res.error));
          return json({ device: res.data });
        } catch (e) {
          return serverError(e);
        }
      },
    },

    "/api/push/devices/:id": {
      DELETE: (req: BunRequest<"/api/push/devices/:id">) => {
        try {
          notifications.unsubscribe(req.params.id);
          return json({ ok: true });
        } catch (e) {
          return serverError(e);
        }
      },
    },

    "/api/push/devices/:id/test": {
      POST: async (req: BunRequest<"/api/push/devices/:id/test">) => {
        try {
          const res = await notifications.sendTest(req.params.id);
          if (!res.ok) return json({ error: res.error }, errorStatus(res.error));
          return json({ ok: true });
        } catch (e) {
          return serverError(e);
        }
      },
    },
  };
}
