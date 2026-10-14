/**
 * Rute non-API yang menyajikan file: asset statis PWA dari root paket
 * (`PUBLIC_DIR`, bukan cwd — aman untuk global install) dan shell SPA untuk
 * rute halaman terdaftar.
 */

import path from "node:path";
import type { BunRequest, HTMLBundle } from "bun";
import { PUBLIC_DIR } from "../../paths";

async function staticFile(filePath: string, contentType: string): Promise<Response> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) return new Response("Not Found", { status: 404 });
  return new Response(file, { headers: { "content-type": contentType } });
}

/** Asset statis PWA (manifest, service worker, logo, suara, ikon). */
export function publicAssetRoutes() {
  return {
    "/manifest.json": () =>
      staticFile(path.join(PUBLIC_DIR, "manifest.json"), "application/manifest+json"),
    "/sw.js": () => staticFile(path.join(PUBLIC_DIR, "sw.js"), "text/javascript"),
    "/logo.svg": () => staticFile(path.join(PUBLIC_DIR, "logo.svg"), "image/svg+xml"),
    "/sounds/notification.ogg": () =>
      staticFile(path.join(PUBLIC_DIR, "sounds", "notification.ogg"), "audio/ogg"),
    "/icons/:name": (req: BunRequest<"/icons/:name">) => {
      const name = req.params.name;
      // Whitelist nama file agar tidak bisa path traversal keluar dari public/icons.
      if (!/^[a-z0-9-]+\.png$/.test(name)) return new Response("Not Found", { status: 404 });
      return staticFile(path.join(PUBLIC_DIR, "icons", name), "image/png");
    },
  };
}

/**
 * Shell SPA hanya untuk rute halaman terdaftar (disuntik entry, default
 * 404) — path tak dikenal tidak menangkap shell SPA.
 */
export function spaRoutes(
  spaPaths: string[] | undefined,
  spa: Response | HTMLBundle | undefined,
): Record<string, Response | HTMLBundle> {
  return Object.fromEntries(
    (spaPaths ?? []).map((pattern) => [pattern, spa ?? new Response("Not Found", { status: 404 })]),
  );
}
