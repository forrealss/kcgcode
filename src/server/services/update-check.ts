/**
 * Cek versi terbaru KCG Code di npm registry — sumber notifikasi "update
 * tersedia" di dashboard terminal, `kcgcode --version` / `status`, sidebar,
 * dan Settings -> About.
 *
 * - Hanya aktif untuk binary global (mode `cli`); `bun dev` dari repo tidak
 *   mengecek. Matikan dengan `KCG_NO_UPDATE_CHECK=1` (atau `NO_UPDATE_NOTIFIER`).
 * - `start()`: hasil terakhir dibaca dari cache (`update-check.json`, di
 *   samping SQLite) agar langsung tersedia, lalu registry dicek di background
 *   dan diulang tiap 6 jam. Gagal (offline) = diam, hasil lama tetap dipakai.
 * - Hanya dist-tag `latest` yang dibaca, dan versinya divalidasi semver ketat
 *   sebelum dipakai: teks dari jaringan ini tampil di terminal & UI.
 */
import path from "node:path";
import { type PackageInfo, readPackageInfo } from "../../cli/theme";
import { resolveEffectiveDbPath } from "../../paths";
import { isCliMode } from "../../runtime";

export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;
const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export interface UpdateInfo {
  /** Versi yang sedang berjalan. */
  current: string;
  /** Versi terbaru di npm (dist-tag `latest`). */
  latest: string;
  /** Perintah untuk memperbarui, mis. `bun i -g kcg-code@latest`. */
  command: string;
}

export interface UpdateChecker {
  /** Update yang tersedia; null = sudah terbaru, belum dicek, atau nonaktif. */
  available(): UpdateInfo | null;
  /** Muat cache, cek registry, lalu jadwalkan cek berkala. */
  start(): Promise<void>;
  /** Cek registry sekarang. */
  check(): Promise<UpdateInfo | null>;
  close(): void;
}

export interface UpdateCheckerOptions {
  /** Default: `updateCheckEnabled()`. */
  enabled?: boolean;
  fetch?: typeof fetch;
  registry?: string;
  cachePath?: string;
  intervalMs?: number;
  readPackage?: () => Promise<PackageInfo>;
  now?: () => number;
}

interface UpdateCache {
  latest: string;
  checkedAt: number;
}

export function isValidVersion(v: unknown): v is string {
  return typeof v === "string" && v.length <= 64 && SEMVER_RE.test(v);
}

export function updateCommand(packageName: string): string {
  return `bun i -g ${packageName}@latest`;
}

/** Update tersedia bila `latest` valid & lebih baru dari versi paket. */
export function resolveUpdate(pkg: PackageInfo, latest: string | null): UpdateInfo | null {
  if (!isValidVersion(latest) || !isValidVersion(pkg.version)) return null;
  if (Bun.semver.order(latest, pkg.version) <= 0) return null;
  return { current: pkg.version, latest, command: updateCommand(pkg.name) };
}

/**
 * Versi `installed` sudah setara/lebih baru dari update — mis. paket global
 * sudah diperbarui tapi daemon masih menjalankan versi lama (perlu restart).
 */
export function isUpdateInstalled(update: UpdateInfo, installed: string): boolean {
  return isValidVersion(installed) && Bun.semver.order(installed, update.latest) >= 0;
}

export function updateCheckEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return isCliMode() && env.KCG_NO_UPDATE_CHECK !== "1" && !env.NO_UPDATE_NOTIFIER;
}

/** Registry npm: hormati `NPM_CONFIG_REGISTRY` (mirror), selain itu registry.npmjs.org. */
export function registryUrl(env: Record<string, string | undefined> = process.env): string {
  const raw = env.NPM_CONFIG_REGISTRY ?? env.npm_config_registry;
  if (!raw) return DEFAULT_REGISTRY;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return DEFAULT_REGISTRY;
    return url.href.replace(/\/+$/, "");
  } catch {
    return DEFAULT_REGISTRY;
  }
}

/** Versi dist-tag `latest`; null bila respons tidak valid. Error jaringan dilempar. */
export async function fetchLatestVersion(
  packageName: string,
  opts: { fetch?: typeof fetch; registry?: string } = {},
): Promise<string | null> {
  const name = encodeURIComponent(packageName).replace(/^%40/, "@");
  const res = await (opts.fetch ?? fetch)(`${opts.registry ?? DEFAULT_REGISTRY}/${name}/latest`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { version?: unknown };
  return isValidVersion(body.version) ? body.version : null;
}

export function updateCachePath(): string {
  return path.join(path.dirname(resolveEffectiveDbPath()), "update-check.json");
}

export async function readUpdateCache(file = updateCachePath()): Promise<UpdateCache | null> {
  try {
    const f = Bun.file(file);
    if (!(await f.exists())) return null;
    const data = (await f.json()) as Partial<UpdateCache>;
    if (!isValidVersion(data.latest) || typeof data.checkedAt !== "number") return null;
    return { latest: data.latest, checkedAt: data.checkedAt };
  } catch {
    return null;
  }
}

/**
 * Update dari cache saja (tanpa jaringan) — untuk perintah CLI singkat
 * seperti `kcgcode --version`. Null bila pengecekan dimatikan.
 */
export async function cachedUpdate(): Promise<UpdateInfo | null> {
  if (!updateCheckEnabled()) return null;
  const [pkg, cache] = await Promise.all([readPackageInfo(), readUpdateCache()]);
  return resolveUpdate(pkg, cache?.latest ?? null);
}

const DISABLED: UpdateChecker = {
  available: () => null,
  start: async () => {},
  check: async () => null,
  close() {},
};

export function createUpdateChecker(opts: UpdateCheckerOptions = {}): UpdateChecker {
  if (!(opts.enabled ?? updateCheckEnabled())) return DISABLED;

  const cachePath = opts.cachePath ?? updateCachePath();
  const registry = opts.registry ?? registryUrl();
  const now = opts.now ?? Date.now;
  let pkg: PackageInfo | null = null;
  let latest: string | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const available = () => (pkg ? resolveUpdate(pkg, latest) : null);

  async function check(): Promise<UpdateInfo | null> {
    pkg ??= await (opts.readPackage ?? readPackageInfo)();
    try {
      const version = await fetchLatestVersion(pkg.name, { fetch: opts.fetch, registry });
      if (version) {
        latest = version;
        const cache: UpdateCache = { latest: version, checkedAt: now() };
        await Bun.write(cachePath, `${JSON.stringify(cache)}\n`);
      }
    } catch {
      // Offline / registry tak terjangkau / cache tak bisa ditulis: pakai hasil lama.
    }
    return available();
  }

  return {
    available,
    check,
    async start() {
      pkg ??= await (opts.readPackage ?? readPackageInfo)();
      latest ??= (await readUpdateCache(cachePath))?.latest ?? null;
      if (closed) return;
      timer = setInterval(() => void check(), opts.intervalMs ?? UPDATE_CHECK_INTERVAL_MS);
      timer.unref?.();
      await check();
    },
    close() {
      closed = true;
      if (timer) clearInterval(timer);
    },
  };
}
