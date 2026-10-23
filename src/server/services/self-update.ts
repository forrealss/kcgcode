/**
 * Update KCG Code dari app — tombol "Update now" di Settings -> About.
 *
 * - Memasang versi `latest` hasil `UpdateChecker` (sudah divalidasi semver)
 *   dengan `bun add -g <paket>@<versi>` memakai Bun yang menjalankan server;
 *   tidak ada input pengguna yang masuk ke perintah.
 * - Hanya untuk binary global Bun (mode `cli`, paket di
 *   `<BUN_INSTALL>/install/global/node_modules`). Selain itu (bun dev, npm,
 *   checkout git) `unsupported` diisi dan UI menampilkan perintah manual.
 * - Progres diambil dari baris output `bun add` ("Resolving dependencies",
 *   "Resolved, downloaded and extracted", "Saved lockfile", "installed …"),
 *   bukan perkiraan waktu — bun tidak mencetak persentase.
 * - Setelah terpasang, versi di package.json paket dibaca ulang dari disk:
 *   bila belum berubah, paket terpasang di tempat lain (`UPDATE_VERIFY_FAILED`).
 * - Restart: `restart` disuntik entry CLI hanya di mode background (daemon);
 *   tanpa itu fase berakhir `installed` dan pengguna me-restart kcgcode.
 *
 * Job disimpan di memori: proses baru setelah restart mulai dari `idle`,
 * lalu mendeteksi versi terpasang yang belum dijalankan (`installed`).
 */
import { realpathSync } from "node:fs";
import path from "node:path";
import { readPackageInfo } from "../../cli/theme";
import { resolveEffectiveDbPath } from "../../paths";
import { isCliMode } from "../../runtime";
import type {
  SelfUpdatePhase,
  SelfUpdateStatus,
  SelfUpdateStep,
  SelfUpdateUnsupported,
} from "../../types";
import type { Result } from "../result";
import { TunnelLogBuffer } from "./tunnel/log-buffer";
import { isUpdateInstalled, isValidVersion, type UpdateChecker } from "./update-check";

/** Dependensi biasanya sudah ada di cache Bun; batas longgar untuk koneksi lambat. */
export const INSTALL_TIMEOUT_MS = 15 * 60_000;
/** Jeda sebelum restart agar klien sempat membaca fase `restarting`. */
export const RESTART_DELAY_MS = 1500;

const STEP_PROGRESS: Record<SelfUpdateStep, number> = {
  preparing: 5,
  downloading: 20,
  linking: 65,
  verifying: 90,
};

/** Tonggak output `bun add` -> tahap + progres; null bila baris biasa. */
export function milestoneFromLine(line: string): { step: SelfUpdateStep; progress: number } | null {
  if (line.startsWith("Resolving dependencies")) {
    return { step: "downloading", progress: STEP_PROGRESS.downloading };
  }
  if (line.startsWith("Resolved, downloaded and extracted")) {
    return { step: "linking", progress: STEP_PROGRESS.linking };
  }
  if (line.startsWith("Saved lockfile")) return { step: "linking", progress: 75 };
  if (line.startsWith("installed ")) return { step: "linking", progress: 85 };
  return null;
}

/** Folder paket kcg-code yang sedang berjalan (realpath). */
export function packageRoot(): string {
  const root = path.resolve(import.meta.dir, "../../..");
  try {
    return realpathSync(root);
  } catch {
    return root;
  }
}

/** Paket berada di folder global Bun (`…/install/global/node_modules/…`). */
export function isBunGlobalPackage(root: string): boolean {
  return root.split(path.sep).join("/").includes("/install/global/node_modules/");
}

export function detectUnsupported(root = packageRoot()): SelfUpdateUnsupported | null {
  if (!isCliMode()) return "NOT_CLI";
  if (!isBunGlobalPackage(root)) return "NOT_BUN_GLOBAL";
  return null;
}

/** Versi di package.json paket, dibaca ulang dari disk (bukan cache import). */
export async function readInstalledVersion(root = packageRoot()): Promise<string | null> {
  try {
    const pkg = (await Bun.file(path.join(root, "package.json")).json()) as { version?: unknown };
    return isValidVersion(pkg.version) ? pkg.version : null;
  } catch {
    return null;
  }
}

export interface InstallerProcess {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(): void;
}

export type SpawnInstaller = (cmd: string[], opts: { cwd: string }) => InstallerProcess;

const defaultSpawn: SpawnInstaller = (cmd, { cwd }) =>
  Bun.spawn(cmd, { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });

export interface SelfUpdaterOptions {
  updates: UpdateChecker;
  /** Session `running` yang akan terhenti saat restart. */
  runningSessions: () => Array<{ id: string; title: string | null }>;
  /** Restart ke versi baru (hanya mode daemon). null/undefined = manual. */
  restart?: (() => void) | null;
  /** Default: `detectUnsupported()`. */
  unsupported?: SelfUpdateUnsupported | null;
  packageName?: () => Promise<string>;
  readInstalledVersion?: () => Promise<string | null>;
  spawn?: SpawnInstaller;
  /** Folder kerja installer (jauh dari bunfig/package.json project). */
  cwd?: string;
  bunPath?: string;
  timeoutMs?: number;
  restartDelayMs?: number;
}

export interface SelfUpdater {
  status(): Promise<SelfUpdateStatus>;
  /** Mulai pasang `version` (harus = update yang tersedia). */
  start(version: string): Promise<Result<SelfUpdateStatus>>;
  logs(from: number): { lines: string[]; next: number };
  /** Selesai job berjalan (untuk test). */
  settled(): Promise<void>;
}

/** Baca stream per baris. */
async function readLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> {
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for await (const chunk of stream) {
      buf += decoder.decode(chunk, { stream: true });
      let nl = buf.indexOf("\n");
      while (nl >= 0) {
        onLine(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        nl = buf.indexOf("\n");
      }
    }
  } catch {
    // stream ditutup paksa (kill)
  }
  if (buf) onLine(buf);
}

export function createSelfUpdater(opts: SelfUpdaterOptions): SelfUpdater {
  const unsupported = opts.unsupported === undefined ? detectUnsupported() : opts.unsupported;
  const spawn = opts.spawn ?? defaultSpawn;
  const readInstalled = opts.readInstalledVersion ?? (() => readInstalledVersion());
  const packageName = opts.packageName ?? (async () => (await readPackageInfo()).name);

  let phase: SelfUpdatePhase = "idle";
  let step: SelfUpdateStep | null = null;
  let progress = 0;
  let target: string | null = null;
  let error: string | null = null;
  let log = new TunnelLogBuffer(() => []);
  let job: Promise<void> = Promise.resolve();

  const busy = () => phase === "installing" || phase === "verifying" || phase === "restarting";

  function snapshot(): SelfUpdateStatus {
    return {
      phase,
      step,
      progress,
      target,
      error,
      logOffset: log.total,
      unsupported,
      restart: opts.restart ? "auto" : "manual",
      runningSessions: opts.runningSessions(),
    };
  }

  function fail(code: string, message: string): void {
    log.write(message);
    phase = "failed";
    step = null;
    error = code;
  }

  async function install(name: string, version: string): Promise<void> {
    const spec = `${name}@${version}`;
    log.write(`$ bun add -g ${spec}`);
    let proc: InstallerProcess;
    try {
      proc = spawn([opts.bunPath ?? process.execPath, "add", "-g", spec], {
        cwd: opts.cwd ?? path.dirname(resolveEffectiveDbPath()),
      });
    } catch (err) {
      fail("UPDATE_INSTALL_FAILED", `Couldn't start bun: ${(err as Error).message}`);
      return;
    }

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, opts.timeoutMs ?? INSTALL_TIMEOUT_MS);
    const onLine = (line: string) => {
      log.write(line);
      const m = milestoneFromLine(line.trim());
      if (m && m.progress > progress) {
        step = m.step;
        progress = m.progress;
      }
    };
    const [code] = await Promise.all([
      proc.exited,
      readLines(proc.stdout, onLine),
      readLines(proc.stderr, onLine),
    ]);
    clearTimeout(timer);

    if (timedOut) return fail("UPDATE_TIMEOUT", "Installation timed out and was stopped.");
    if (code !== 0) return fail("UPDATE_INSTALL_FAILED", `bun exited with code ${code}.`);

    phase = "verifying";
    step = "verifying";
    progress = STEP_PROGRESS.verifying;
    const installed = await readInstalled();
    if (!installed || Bun.semver.order(installed, version) < 0) {
      return fail(
        "UPDATE_VERIFY_FAILED",
        `This copy of KCG Code is still v${installed ?? "?"} — bun installed v${version} somewhere else.`,
      );
    }

    step = null;
    progress = 100;
    if (opts.restart) {
      phase = "restarting";
      log.write(`v${version} installed. Restarting KCG Code…`);
      const restart = opts.restart;
      setTimeout(restart, opts.restartDelayMs ?? RESTART_DELAY_MS);
    } else {
      phase = "installed";
      log.write(`v${version} installed. Restart kcgcode to start using it.`);
    }
  }

  return {
    async status() {
      // Versi baru sudah terpasang (mis. dari terminal) tapi belum dijalankan.
      const update = opts.updates.available();
      if (phase === "idle" && update && unsupported === null) {
        const installed = await readInstalled();
        if (phase === "idle" && installed && isUpdateInstalled(update, installed)) {
          phase = "installed";
          target = installed;
          progress = 100;
        }
      }
      return snapshot();
    },

    async start(version) {
      if (unsupported) return { ok: false, error: "UPDATE_UNSUPPORTED" };
      if (busy()) return { ok: false, error: "UPDATE_IN_PROGRESS" };
      const update = opts.updates.available();
      if (!update || update.latest !== version) return { ok: false, error: "UPDATE_NOT_AVAILABLE" };
      if (phase === "installed" && target === version) return { ok: true, data: snapshot() };

      phase = "installing";
      step = "preparing";
      progress = STEP_PROGRESS.preparing;
      target = version;
      error = null;
      log = new TunnelLogBuffer(() => []);
      job = packageName()
        .then((name) => install(name, version))
        .catch((err: unknown) => fail("UPDATE_INSTALL_FAILED", String(err)));
      return { ok: true, data: snapshot() };
    },

    logs: (from) => log.read(from),
    settled: () => job,
  };
}
