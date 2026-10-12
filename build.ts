import { cp, rm } from "node:fs/promises";
import path from "node:path";
import tailwind from "bun-plugin-tailwind";

/**
 * Build frontend statis.
 *
 *   bun run build.ts                                  # deploy statis → dist/
 *   bun run build.ts --outdir dist/web --no-sourcemap # paket npm (prepack)
 *
 * Paket npm memakai hasil build ini, bukan bundling HTML saat runtime: install
 * global bisa punya dua salinan React di node_modules ("Invalid hook call") dan
 * plugin Tailwind dari bunfig.toml hanya terbaca bila cwd = root repo.
 */
const argv = process.argv.slice(2);
const outdirArg = argv[argv.indexOf("--outdir") + 1];
const outdir = path.resolve(argv.includes("--outdir") && outdirArg ? outdirArg : "dist");
const sourcemap = argv.includes("--no-sourcemap") ? "none" : "linked";
await rm(outdir, { recursive: true, force: true });

const entrypoints = [...new Bun.Glob("src/**/*.html").scanSync()];

const result = await Bun.build({
  entrypoints,
  outdir,
  plugins: [tailwind],
  minify: true,
  // Pecah dynamic import jadi chunk terpisah: grammar Shiki (syntax
  // highlighting) hanya diunduh saat bahasa itu pertama kali tampil,
  // bukan ikut bundle utama.
  splitting: true,
  target: "browser",
  sourcemap,
  // URL aset absolut: rute SPA bertingkat (/projects/abc) tetap memuat chunk.
  publicPath: "/",
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
});

// Salin asset PWA (manifest, service worker, logo) ke output build agar
// deploy statis tetap menyertakan prasyarat instalasi PWA (Requirement 8.1).
await cp(path.join(process.cwd(), "public"), outdir, { recursive: true });

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

for (const output of result.outputs) {
  console.log(
    ` ${path.relative(process.cwd(), output.path)}  ${(output.size / 1024).toFixed(1)} KB`,
  );
}
