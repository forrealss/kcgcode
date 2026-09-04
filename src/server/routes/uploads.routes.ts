/**
 * Tabel rute muat & hapus lampiran gambar (`/api/uploads/:sessionId/:id`).
 *
 * GET mengalirkan bytes gambar untuk bubble & reattach; DELETE menghapus
 * lampiran yang belum terkirim (pengguna membatalkan). Dipasang composition
 * root (`app.ts`) — pola kcgrouter (`*.routes.ts`).
 */
import type { BunRequest } from "bun";
import { errorStatus, json, serverError } from "./helpers";
import type { ApiRouteContext } from "./types";

export function uploadsRoutes(ctx: ApiRouteContext) {
  const { attachments, guard } = ctx;
  return {
    // ---- Muat gambar upload (render bubble & reattach) ----
    "/api/uploads/:sessionId/:id": {
      GET: guard((req: BunRequest<"/api/uploads/:sessionId/:id">) => {
        try {
          const res = attachments.read(req.params.sessionId, req.params.id);
          if (!res.ok) return json({ error: res.error }, errorStatus(res.error));
          // Salin ke Uint8Array ber-buffer ArrayBuffer agar lolos tipe BodyInit.
          const bytes = new Uint8Array(res.data.bytes);
          return new Response(new Blob([bytes]), {
            headers: { "content-type": res.data.mime },
          });
        } catch (e) {
          return serverError(e);
        }
      }),
      /** Hapus lampiran yang belum terkirim (pengguna membatalkan). */
      DELETE: guard((req: BunRequest<"/api/uploads/:sessionId/:id">) => {
        try {
          attachments.remove(req.params.sessionId, req.params.id);
          return json({ ok: true });
        } catch (e) {
          return serverError(e);
        }
      }),
    },
  };
}
