/**
 * Info aplikasi untuk halaman Settings -> About.
 *
 * Versi diambil dari `package.json` paket (root repo / paket global),
 * kecuali saat development (`bun dev` = mode runtime `dev` tanpa
 * `NODE_ENV=production`): versinya ditampilkan sebagai `"dev"` agar build
 * lokal tidak tertukar dengan rilis.
 *
 * `update` berisi versi baru di npm bila ada (lihat `update-check.ts`).
 */
import { readPackageVersion } from "../../cli/theme";
import { getRunMode, type RunMode } from "../../runtime";
import type { UpdateChecker, UpdateInfo } from "./update-check";

export interface AppInfo {
  /** Versi semver dari package.json, atau `"dev"` saat development. */
  version: string;
  /** Versi baru yang tersedia; null = sudah terbaru / belum dicek / nonaktif. */
  update: UpdateInfo | null;
}

/** Fungsi murni: tentukan label versi dari mode runtime & NODE_ENV. */
export function resolveVersionLabel(
  packageVersion: string,
  mode: RunMode,
  nodeEnv: string | undefined,
): string {
  return mode === "dev" && nodeEnv !== "production" ? "dev" : packageVersion;
}

export async function readAppInfo(updates?: UpdateChecker): Promise<AppInfo> {
  const pkg = await readPackageVersion();
  return {
    version: resolveVersionLabel(pkg, getRunMode(), process.env.NODE_ENV),
    update: updates?.available() ?? null,
  };
}
