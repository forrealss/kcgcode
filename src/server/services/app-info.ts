/**
 * Info aplikasi untuk halaman Settings -> About.
 *
 * Versi diambil dari `package.json` paket (root repo / paket global),
 * kecuali saat development (`bun dev` = mode runtime `dev` tanpa
 * `NODE_ENV=production`): versinya ditampilkan sebagai `"dev"` agar build
 * lokal tidak tertukar dengan rilis.
 */
import { readPackageVersion } from "../../cli/theme";
import { getRunMode, type RunMode } from "../../runtime";

export interface AppInfo {
  /** Versi semver dari package.json, atau `"dev"` saat development. */
  version: string;
}

/** Fungsi murni: tentukan label versi dari mode runtime & NODE_ENV. */
export function resolveVersionLabel(
  packageVersion: string,
  mode: RunMode,
  nodeEnv: string | undefined,
): string {
  return mode === "dev" && nodeEnv !== "production" ? "dev" : packageVersion;
}

export async function readAppInfo(): Promise<AppInfo> {
  const pkg = await readPackageVersion();
  return { version: resolveVersionLabel(pkg, getRunMode(), process.env.NODE_ENV) };
}
