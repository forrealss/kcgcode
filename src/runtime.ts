/**
 * Mode runtime: `dev` (bun dev / src/index.ts di repo) vs
 * `cli` (binary global `kcgcode` via bin/kcgcode.ts).
 *
 * CLI selalu memakai user home (`~/.kcgcode`) untuk config + data.
 * Dev memprioritaskan path lokal di cwd (config + ./data) supaya
 * development di repo tidak menyentuh data user global.
 */
export type RunMode = "dev" | "cli";

let mode: RunMode = "dev";

/** Set mode runtime — dipanggil sekali di entry (bin CLI = "cli"). */
export function setRunMode(next: RunMode): void {
  mode = next;
}

export function getRunMode(): RunMode {
  return mode;
}

export function isCliMode(): boolean {
  return mode === "cli";
}
