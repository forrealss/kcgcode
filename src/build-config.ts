/**
 * Build-time constants, stamped into the npm package by `scripts/stamp-build-config.ts`
 * (`prepack`) and reset to empty by `postpack`, so the repo never contains a
 * deployment-specific value.
 *
 * Do not edit by hand: set `KCG_TUNNEL_API_URL` in `.env` for development, and
 * it's baked in automatically when you run `bun publish` / `bun pm pack`.
 */
export const BUILD_TUNNEL_API_URL: string = "";
