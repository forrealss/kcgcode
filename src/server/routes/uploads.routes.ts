/**
 * Tabel rute muat & hapus lampiran gambar (`/api/uploads/:sessionId/:id`).
 *
 * GET mengalirkan bytes gambar untuk bubble & reattach; DELETE menghapus
 * lampiran yang belum terkirim (pengguna membatalkan). Dipasang composition
 * root (`app.ts`) — pola kcgcode (`*.routes.ts`).
 */
import type { BunRequest } from "bun";
import { isPreviewableImage } from "../../lib/attachments";
import { errorStatus, json, serverError } from "./helpers";
import type { ApiRouteContext } from "./types";

export function uploadsRoutes(ctx: ApiRouteContext) {
  const { attachments } = ctx;
  return {
    // ---- Muat gambar upload (render bubble & reattach) ----
    "/api/uploads/:sessionId/:id": {
      GET: (req: BunRequest<"/api/uploads/:sessionId/:id">) => {
        try {
          const res = attachments.read(req.params.sessionId, req.params.id);
          if (!res.ok) return json({ error: res.error }, errorStatus(res.error));
          // Salin ke Uint8Array ber-buffer ArrayBuffer agar lolos tipe BodyInit.
          const bytes = new Uint8Array(res.data.bytes);
          // Lampiran bisa file apa saja (html/svg/js …) dan disajikan dari
          // origin yang sama dengan aplikasi: hanya gambar raster yang boleh
          // tampil inline; sisanya dipaksa unduh + nosniff + CSP sandbox agar
          // tidak pernah dieksekusi browser (XSS).
          const inline = isPreviewableImage(res.data.mime);
          const name = encodeURIComponent(res.data.filename);
          return new Response(new Blob([bytes]), {
            headers: {
              "content-type": inline ? res.data.mime : "application/octet-stream",
              "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${name}`,
              "x-content-type-options": "nosniff",
              "content-security-policy": "default-src 'none'; sandbox",
              "cache-control": "private, max-age=3600",
            },
          });
        } catch (e) {
          return serverError(e);
        }
      },
      /** Hapus lampiran yang belum terkirim (pengguna membatalkan). */
      DELETE: (req: BunRequest<"/api/uploads/:sessionId/:id">) => {
        try {
          attachments.remove(req.params.sessionId, req.params.id);
          return json({ ok: true });
        } catch (e) {
          return serverError(e);
        }
      },
    },
  };
}
