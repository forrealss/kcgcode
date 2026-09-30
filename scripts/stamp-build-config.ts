/**
 * `prepack` / `postpack` hook: bake the tunnel API URL into the published
 * package without ever committing it.
 *
 *   bun scripts/stamp-build-config.ts          # prepack: write KCG_TUNNEL_API_URL
 *   bun scripts/stamp-build-config.ts --reset  # postpack: back to ""
 *
 * Bun loads `.env` automatically, so the value comes from `.env` (or the
 * shell / CI environment). Publishing without it fails loudly instead of
 * shipping a package whose Remote access can never work.
 */
import path from "node:path";
import { parseTunnelApiUrl } from "../src/server/services/tunnel-config";

const FILE = path.join(import.meta.dir, "..", "src", "build-config.ts");
const reset = process.argv.includes("--reset");

let url = "";
if (!reset) {
  const parsed = parseTunnelApiUrl(process.env.KCG_TUNNEL_API_URL);
  if (!parsed.ok || !parsed.url) {
    console.error(
      "[prepack] KCG_TUNNEL_API_URL must be set to an http(s) URL (e.g. in .env) before publishing.",
    );
    process.exit(1);
  }
  if (!parsed.url.startsWith("https://")) {
    console.error("[prepack] KCG_TUNNEL_API_URL must use https:// for a published package.");
    process.exit(1);
  }
  url = parsed.url;
}

const src = await Bun.file(FILE).text();
const next = src.replace(
  /export const BUILD_TUNNEL_API_URL: string = ".*";/,
  `export const BUILD_TUNNEL_API_URL: string = ${JSON.stringify(url)};`,
);
if (next === src && !src.includes(`= ${JSON.stringify(url)};`)) {
  console.error("[prepack] could not find BUILD_TUNNEL_API_URL in src/build-config.ts");
  process.exit(1);
}
await Bun.write(FILE, next);
console.log(
  reset
    ? "[postpack] tunnel API URL reset"
    : `[prepack] tunnel API URL: ${url} (if packing fails, run: bun scripts/stamp-build-config.ts --reset)`,
);
