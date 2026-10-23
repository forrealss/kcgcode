/**
 * Frontend hasil build (`build.ts --outdir dist/web`) yang ikut paket npm.
 *
 * Binary global memakai ini, bukan bundling HTML import saat runtime: di
 * node_modules global bisa ada dua salinan React (library ter-hoist memakai
 * React milik paket lain → "Cannot read properties of null (reading
 * 'useState')"), dan plugin Tailwind dari bunfig.toml hanya terbaca bila cwd
 * = root repo. Build dilakukan sekali di repo (prepack) dengan satu React.
 *
 * Seluruh file dibaca ke memori saat start: update paket (`bun add -g`,
 * juga dari Settings -> About) mengganti `dist/web` di disk sebelum kcgcode
 * di-restart — index.html lama harus tetap mendapat chunk lamanya.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type AssetRoutes = Record<string, () => Response>;

export interface PrebuiltWeb {
  /** Shell SPA (index.html) untuk semua `spaPaths`. */
  spa: Response;
  /** Chunk JS/CSS & asset lain, per path URL. */
  assets: AssetRoutes;
}

/** Chunk ber-hash aman di-cache selamanya; selain itu selalu revalidasi. */
function cacheControl(file: string): string {
  return /^chunk-[a-z0-9]+\./.test(path.basename(file)) || /-[a-z0-9]{8}\.\w+$/.test(file)
    ? "public, max-age=31536000, immutable"
    : "no-cache";
}

/** Rute frontend dari `dir`; null bila belum di-build (mis. checkout git). */
export function loadPrebuiltWeb(dir: string): PrebuiltWeb | null {
  const indexPath = path.join(dir, "index.html");
  if (!existsSync(indexPath)) return null;

  const assets: AssetRoutes = {};
  for (const rel of new Bun.Glob("**/*").scanSync({ cwd: dir })) {
    if (rel === "index.html" || rel.endsWith(".map")) continue;
    const file = path.join(dir, rel);
    const bytes = readFileSync(file);
    const headers = { "cache-control": cacheControl(rel), "content-type": Bun.file(file).type };
    assets[`/${rel.split(path.sep).join("/")}`] = () => new Response(bytes, { headers });
  }

  const spa = new Response(readFileSync(indexPath), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" },
  });
  return { spa, assets };
}
