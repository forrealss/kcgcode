/**
 * Mode background (daemon) untuk kcgcode.
 *
 * `kcgcode start -d` men-spawn proses anak yang lepas dari terminal
 * (session baru via `detached`, stdio ke file log), lalu parent keluar.
 * Menutup terminal tidak membunuh server.
 *
 * State daemon disimpan di `<data>/daemon.json` (samping SQLite, ikut mode
 * runtime) — dipakai `status`, `stop`, `logs`, dan cek single-instance.
 */
import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { resolveEffectiveDbPath } from "../paths";
import type { CliArgs } from "./args";
import { type DashboardSnapshot, formatUptime } from "./dashboard";
import { c, centerBlock, panel, readPackageVersion, row, symbols } from "./theme";
import { updateRowText } from "./update-notice";

/** Penanda env untuk proses anak daemon. */
export const DAEMON_CHILD_ENV = "KCG_DAEMON_CHILD";

const READY_TIMEOUT_MS = 15_000;
const STOP_TIMEOUT_MS = 10_000;
const POLL_MS = 150;
/** Log dirotasi ke `.1` saat start bila melewati ukuran ini. */
const MAX_LOG_BYTES = 5 * 1024 * 1024;

export interface DaemonState {
  pid: number;
  port: number;
  hostname: string;
  localUrl: string;
  /** URL publik tunnel terakhir yang diketahui (diperbarui berkala). */
  publicUrl: string | null;
  startedAt: number;
  logFile: string;
  /** Data dashboard terbaru — dibaca dashboard yang memantau daemon. */
  snapshot?: DashboardSnapshot;
}

export function isDaemonChild(): boolean {
  return process.env[DAEMON_CHILD_ENV] === "1";
}

function runDir(): string {
  return path.dirname(resolveEffectiveDbPath());
}

export function daemonStatePath(): string {
  return path.join(runDir(), "daemon.json");
}

export function daemonLogPath(): string {
  return path.join(runDir(), "kcgcode.log");
}

/** true bila proses dengan pid ini masih hidup. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = proses ada tapi milik user lain.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function readDaemonState(): Promise<DaemonState | null> {
  const file = Bun.file(daemonStatePath());
  if (!(await file.exists())) return null;
  try {
    return (await file.json()) as DaemonState;
  } catch {
    return null;
  }
}

/** State daemon yang prosesnya masih hidup; state basi dibersihkan. */
export async function runningDaemon(): Promise<DaemonState | null> {
  const state = await readDaemonState();
  if (!state) return null;
  if (isAlive(state.pid)) return state;
  clearDaemonState();
  return null;
}

export async function writeDaemonState(state: DaemonState): Promise<void> {
  await Bun.write(daemonStatePath(), `${JSON.stringify(state, null, 2)}\n`);
}

/** Hapus state — hanya bila milik pid ini (default: proses sekarang). */
export function clearDaemonState(ownerPid?: number): void {
  const p = daemonStatePath();
  if (!existsSync(p)) return;
  if (ownerPid !== undefined) {
    try {
      const state = JSON.parse(readFileSync(p, "utf8")) as DaemonState;
      if (state.pid !== ownerPid) return;
    } catch {
      // state rusak — hapus saja
    }
  }
  rmSync(p, { force: true });
}

/** Argumen yang diteruskan ke proses anak (tanpa -d / --open). */
export function childArgv(args: CliArgs): string[] {
  const out = ["start"];
  if (args.port !== undefined) out.push("--port", String(args.port));
  if (args.host !== undefined) out.push("--host", args.host);
  if (args.config !== undefined) out.push("--config", path.resolve(args.config));
  if (args.allowSleep) out.push("--allow-sleep");
  return out;
}

function rotateLog(logFile: string): void {
  try {
    if (statSync(logFile).size > MAX_LOG_BYTES) renameSync(logFile, `${logFile}.1`);
  } catch {
    // belum ada log
  }
}

async function tailLines(file: string, n: number): Promise<string[]> {
  const f = Bun.file(file);
  if (!(await f.exists())) return [];
  const size = f.size;
  const text = await f.slice(Math.max(0, size - 64 * 1024), size).text();
  return text
    .split("\n")
    .filter((l) => l.trim() !== "")
    .slice(-n);
}

/** Spawn server di background lalu tunggu sampai siap. */
export async function startDetached(args: CliArgs): Promise<DaemonState> {
  const logFile = daemonLogPath();
  mkdirSync(runDir(), { recursive: true });
  rotateLog(logFile);
  const fd = openSync(logFile, "a");
  writeFileSync(fd, `\n=== kcgcode start ${new Date().toISOString()} ===\n`);

  const script = process.argv[1] as string;
  const child = spawn(process.execPath, [script, ...childArgv(args)], {
    detached: true,
    stdio: ["ignore", fd, fd],
    env: { ...process.env, [DAEMON_CHILD_ENV]: "1" },
    cwd: process.cwd(),
    windowsHide: true,
  });
  child.unref();
  closeSync(fd);

  const pid = child.pid;
  if (!pid) throw new Error("failed to spawn background process");

  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await Bun.sleep(POLL_MS);
    const state = await readDaemonState();
    if (state?.pid === pid) return state;
    if (!isAlive(pid)) {
      const tail = await tailLines(logFile, 8);
      throw new Error(
        `background process exited during startup${tail.length ? `:\n${tail.join("\n")}` : ""}`,
      );
    }
  }
  throw new Error(`server not ready after ${READY_TIMEOUT_MS / 1000}s — check ${logFile}`);
}

/**
 * Skrip helper restart (dijalankan `bun -e`, lepas dari daemon): tunggu
 * daemon lama keluar, lalu `kcgcode start -d` dari file paket di disk —
 * yaitu versi yang baru dipasang. Sengaja mandiri (tanpa import) agar tidak
 * bergantung pada kode versi mana pun.
 */
const RESTART_HELPER = `
const pid = Number(process.env.KCG_RESTART_PID);
const argv = JSON.parse(process.env.KCG_RESTART_ARGV ?? "[]");
const alive = () => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
const deadline = Date.now() + ${STOP_TIMEOUT_MS * 3};
while (alive() && Date.now() < deadline) await Bun.sleep(${POLL_MS});
const env = { ...process.env };
delete env.KCG_RESTART_PID;
delete env.KCG_RESTART_ARGV;
console.log("=== restarting kcgcode after update ===");
const child = Bun.spawn([process.execPath, ...argv], { env, stdio: ["ignore", "inherit", "inherit"] });
process.exit(await child.exited);
`;

/**
 * Restart daemon ini ke binary yang baru dipasang: spawn helper terlepas
 * yang menunggu proses ini keluar lalu menjalankan `kcgcode start -d`
 * dengan argumen yang sama. Pemanggil kemudian mematikan proses ini.
 */
export function spawnDaemonRestart(): void {
  const logFile = daemonLogPath();
  const fd = openSync(logFile, "a");
  const env: Record<string, string | undefined> = {
    ...process.env,
    KCG_RESTART_PID: String(process.pid),
    // argv daemon: [bun, kcgcode.ts, "start", ...opsi] (tanpa -d).
    KCG_RESTART_ARGV: JSON.stringify([process.argv[1], ...process.argv.slice(2), "--detach"]),
  };
  delete env[DAEMON_CHILD_ENV];
  const child = spawn(process.execPath, ["-e", RESTART_HELPER], {
    detached: true,
    stdio: ["ignore", fd, fd],
    env,
    cwd: process.cwd(),
    windowsHide: true,
  });
  child.unref();
  closeSync(fd);
}

/** `installed`: versi paket di disk (untuk mendeteksi update yang menunggu restart). */
function statePanel(state: DaemonState, title: string, installed?: string): string {
  const update = state.snapshot?.update;
  return panel(title, [
    row("Status", c.greenBright(`${symbols.bullet} running in background`)),
    row("Local", c.cyan(state.localUrl)),
    ...(state.publicUrl ? [row("Public", c.cyanBright(state.publicUrl))] : []),
    row("PID", c.white(String(state.pid))),
    row("Uptime", c.white(formatUptime(Date.now() - state.startedAt))),
    row("Log", c.dim(state.logFile)),
    ...(update ? [row("Update", updateRowText(update, installed))] : []),
    "",
    c.dim(`${c.cyan("kcgcode status")} · ${c.cyan("kcgcode logs -f")} · ${c.cyan("kcgcode stop")}`),
  ]);
}

/** `center`: tengahkan seperti dashboard (dipakai setelah keluar dari dashboard). */
export function printStarted(state: DaemonState, opts: { center?: boolean } = {}): void {
  const block = [
    statePanel(state, "KCGCODE"),
    c.dim("You can close this terminal — the server keeps running."),
  ].join("\n");
  console.log(opts.center ? centerBlock(block) : block);
}

/** Pesan saat instance lain sudah jalan di background. */
export function printAlreadyRunning(state: DaemonState): void {
  console.error(
    `${c.yellowBright(symbols.warn)} kcgcode is already running in background ${c.dim(`(pid ${state.pid})`)}`,
  );
  console.error(`  ${c.dim("Open")} ${c.cyan(state.publicUrl ?? state.localUrl)}`);
  console.error(`  ${c.dim("Stop it first with")} ${c.cyan("kcgcode stop")}`);
}

export async function runStatus(): Promise<void> {
  const state = await runningDaemon();
  if (!state) {
    console.log(`${c.dim(symbols.idle)} kcgcode is ${c.yellow("not running")} in background.`);
    console.log(`  ${c.dim("Start it with")} ${c.cyan("kcgcode start -d")}`);
    process.exitCode = 1;
    return;
  }
  console.log(statePanel(state, "KCGCODE", await readPackageVersion()));
}

/** Kirim SIGTERM lalu tunggu; SIGKILL bila tidak keluar dalam batas waktu. */
export async function stopDaemon(state: DaemonState): Promise<"stopped" | "killed"> {
  try {
    process.kill(state.pid, "SIGTERM");
  } catch {
    // sudah mati
  }
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline && isAlive(state.pid)) await Bun.sleep(POLL_MS);

  let result: "stopped" | "killed" = "stopped";
  if (isAlive(state.pid)) {
    process.kill(state.pid, "SIGKILL");
    result = "killed";
  }
  clearDaemonState(state.pid);
  return result;
}

export async function runStop(): Promise<void> {
  const state = await runningDaemon();
  if (!state) {
    console.log(`${c.dim(symbols.idle)} kcgcode is not running in background.`);
    return;
  }
  process.stdout.write(`${c.yellow("Stopping")} kcgcode ${c.dim(`(pid ${state.pid})`)}…`);
  const result = await stopDaemon(state);
  console.log(
    result === "killed"
      ? ` ${c.yellow("force-killed")} ${c.dim("(did not exit within 10s)")}`
      : ` ${c.greenBright(symbols.check)} stopped.`,
  );
}

export async function runLogs(args: CliArgs): Promise<void> {
  const logFile = daemonLogPath();
  if (!existsSync(logFile)) {
    console.log(`${c.dim("No log yet at")} ${c.cyan(logFile)}`);
    return;
  }
  for (const line of await tailLines(logFile, args.lines ?? 50)) console.log(line);
  if (!args.follow) return;

  // Follow: baca byte baru secara berkala (rotasi → mulai dari awal).
  let offset = Bun.file(logFile).size;
  for (;;) {
    await Bun.sleep(500);
    const f = Bun.file(logFile);
    const size = f.size;
    if (size < offset) offset = 0;
    if (size > offset) {
      process.stdout.write(await f.slice(offset, size).text());
      offset = size;
    }
  }
}
