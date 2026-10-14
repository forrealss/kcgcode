/**
 * Perintah CLI: start (server + dashboard) dan init (scaffold config).
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveConfig, saveConfigPort } from "../config";
import { openSessionStore } from "../db";
import spa from "../index.html";
import {
  defaultSandboxDir,
  ensureKcgHome,
  KCG_HOME,
  resolveEffectiveConfigPath,
  resolveEffectiveDbPath,
  resolveEffectiveUploadsDir,
  WEB_DIST_DIR,
} from "../paths";
import { isCliMode } from "../runtime";
import { createKcgServer } from "../server/app";
import { resolveHostname } from "../server/host";
import { loadPrebuiltWeb } from "../server/prebuilt-web";
import { createAuthService } from "../server/services/auth";
import type { CliArgs } from "./args";
import { attachToDaemon } from "./attach";
import {
  clearDaemonState,
  daemonLogPath,
  isDaemonChild,
  printAlreadyRunning,
  printStarted,
  runningDaemon,
  startDetached,
  writeDaemonState,
} from "./daemon";
import { type DashboardInfo, openBrowser, startDashboard, takeSnapshot } from "./dashboard";
import { disabledKeepAwake, startKeepAwake } from "./keep-awake";
import { choosePort, portIsFree, requestedPort } from "./port";
import { runSetup, type SetupOutcome, type SetupState } from "./setup";
import { c, centerBlock, panel, row, symbols } from "./theme";
import { updateNotice } from "./update-notice";

/** Interval daemon menulis state + snapshot dashboard. */
const DAEMON_STATE_MS = 2000;

const SPA_PATHS = ["/", "/projects", "/projects/*", "/skills", "/settings", "/settings/*"];

function applyEnvOverrides(args: CliArgs): void {
  if (args.port !== undefined) process.env.KCG_PORT = String(args.port);
  if (args.host !== undefined) process.env.KCG_HOST = args.host;
  if (args.config !== undefined) process.env.KCG_CONFIG_PATH = args.config;
}

function failConfig(message: string): never {
  console.error(`${c.redBright(symbols.cross)} ${message}`);
  console.error(
    `\n${c.dim("Run")} ${c.cyan("kcgcode init")} ${c.dim("to create")} ${c.cyan("~/.kcgcode/config.json")}${c.dim(".")}`,
  );
  process.exit(1);
}

/** Layar setup: config hilang → tawarkan init; config rusak → tampilkan errornya. */
async function setupInteractive(args: CliArgs, error: string): Promise<SetupOutcome> {
  const configPath = resolveEffectiveConfigPath();
  const initial: SetupState = existsSync(configPath)
    ? { kind: "invalid", configPath, error }
    : { kind: "missing", configPath };
  let initialized = false;
  const outcome = await runSetup(initial, () => {
    try {
      const result = initConfig(args);
      initialized = true;
      return { kind: "ready", ...result };
    } catch (err) {
      return { kind: "failed", configPath, error: (err as Error).message };
    }
  });
  if (outcome === "quit" && initial.kind === "missing") {
    console.log(
      centerBlock(
        initialized
          ? `${c.greenBright(symbols.check)} Config created — run ${c.cyan("kcgcode")} to start.`
          : `${c.dim("Setup skipped — run")} ${c.cyan("kcgcode init")} ${c.dim("when ready.")}`,
      ),
    );
  }
  return outcome;
}

export async function runStart(args: CliArgs): Promise<void> {
  // CLI global = mode produksi: matikan HMR dev yang noisy di luar repo.
  if (process.env.NODE_ENV === undefined) {
    process.env.NODE_ENV = "production";
  }
  // Baca KCG_PORT sebelum di-override `--port`, untuk membedakan asal port.
  const envPort = process.env.KCG_PORT;
  applyEnvOverrides(args);

  const daemonChild = isDaemonChild();
  let cfg = resolveConfig();
  if (!cfg.ok) {
    // Terminal interaktif → layar setup dengan tombol init, bukan error mentah.
    if (daemonChild || !process.stdin.isTTY || !process.stdout.isTTY) failConfig(cfg.error);
    if ((await setupInteractive(args, cfg.error)) === "quit") process.exit(0);
    cfg = resolveConfig();
    if (!cfg.ok) failConfig(cfg.error);
  }
  const config = cfg.data;

  // Port daemon yang dipindah ke terminal ini ("Run in foreground").
  let takeoverPort: number | undefined;
  if (!daemonChild) {
    const existing = await runningDaemon();
    if (existing) {
      if (args.detach || !process.stdout.isTTY) {
        printAlreadyRunning(existing);
        process.exit(1);
      }
      // Sudah jalan di background → buka dashboard untuk daemon tersebut.
      takeoverPort = await attachToDaemon(args, config.configPath, existing);
    }
  }

  const hostname = args.host ?? resolveHostname();
  const choice = await choosePort(
    hostname,
    takeoverPort !== undefined
      ? { port: takeoverPort, source: "config" }
      : requestedPort({ flag: args.port, env: envPort, config: config.port }),
  );
  if (!choice.ok) {
    console.error(`${c.redBright(symbols.cross)} ${choice.error}`);
    console.error(`  ${c.dim("Pick another with")} ${c.cyan("--port <n>")}`);
    process.exit(1);
  }
  const portNote = choice.fallbackFrom ? `${choice.fallbackFrom} in use` : null;

  if (args.detach && !daemonChild) {
    if (portNote) console.log(`${c.yellow(symbols.warn)} Port ${portNote} — using ${choice.port}.`);
    try {
      // Port final dikirim eksplisit agar anak tidak memilih ulang.
      const state = await startDetached({ ...args, port: choice.port });
      printStarted(state);
      if (args.open) await openBrowser(state.localUrl);
    } catch (err) {
      console.error(`${c.redBright(symbols.cross)} ${(err as Error).message}`);
      process.exit(1);
    }
    return;
  }

  // Paket npm membawa frontend prebuilt; checkout git jatuh ke bundling runtime.
  const web = loadPrebuiltWeb(WEB_DIST_DIR);
  const boot = (port: number) =>
    createKcgServer({
      config,
      spa: web?.spa ?? spa,
      assets: web?.assets,
      spaPaths: SPA_PATHS,
      port,
      hostname,
      uploadsRoot: resolveEffectiveUploadsDir(),
    });
  const localUrl = (port: number) =>
    `http://${hostname === "0.0.0.0" || hostname === "::" ? "localhost" : hostname}:${port}`;

  let app = boot(choice.port);
  const info: DashboardInfo = {
    server: app,
    port: app.server.port ?? choice.port,
    hostname,
    portNote,
    startedAt: Date.now(),
  };

  const allowSleep = args.allowSleep || process.env.KCG_ALLOW_SLEEP === "1";
  const keepAwake = allowSleep ? disabledKeepAwake() : await startKeepAwake();
  info.keepAwake = keepAwake;

  let shuttingDown = false;
  let dash: { stop(): void } | null = null;
  let stateTimer: ReturnType<typeof setInterval> | null = null;

  async function shutdown(reason: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    dash?.stop();
    if (stateTimer) clearInterval(stateTimer);
    if (daemonChild) clearDaemonState(process.pid);
    keepAwake.stop();
    // Keluar dari dashboard → pesan ditengahkan seperti dashboard; log daemon tetap polos.
    const say = (line: string) => console.log(dash ? centerBlock(line) : line);
    say(`\n${c.dim(`(${reason})`)} ${c.yellow("Saving session state and stopping…")}`);
    const update = app.updates.available();
    try {
      await app.close();
    } catch (err) {
      console.error(c.red("Shutdown error:"), err);
    }
    say(c.greenBright(`${symbols.check} KCG Code stopped.`));
    if (update && !daemonChild) say(updateNotice(update));
    process.exit(0);
  }

  /** Simpan port ke config lalu restart server di port tersebut. Null = sukses. */
  async function changePort(next: number): Promise<string | null> {
    if (next !== info.port && !(await portIsFree(hostname, next))) {
      return `Port ${next} is already in use`;
    }
    const saved = saveConfigPort(config.configPath, next);
    if (!saved.ok) return saved.error;
    if (next === info.port) {
      info.portNote = null;
      return null;
    }

    info.restarting = true;
    const prev = info.port;
    try {
      await app.close();
      try {
        app = boot(next);
      } catch (err) {
        // Gagal bind di port baru → kembali ke port lama agar server tetap hidup.
        app = boot(prev);
        info.server = app;
        return `Cannot start on port ${next}: ${(err as Error).message}`;
      }
      info.server = app;
      info.port = app.server.port ?? next;
      info.portNote = null;
      return null;
    } finally {
      info.restarting = false;
    }
  }

  /** Pindahkan server ke daemon: tutup server foreground, spawn ulang di background. */
  async function moveToBackground(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    dash?.stop();
    keepAwake.stop();
    console.log(centerBlock(c.yellow("Moving kcgcode to background…")));
    try {
      await app.close();
      const state = await startDetached({ ...args, port: info.port, detach: true });
      printStarted(state, { center: true });
      process.exit(0);
    } catch (err) {
      console.error(
        centerBlock(
          [
            `${c.redBright(symbols.cross)} ${(err as Error).message}`,
            `  ${c.dim("Server is stopped. Run")} ${c.cyan("kcgcode")} ${c.dim("to start again.")}`,
          ].join("\n"),
        ),
      );
      process.exit(1);
    }
  }

  if (daemonChild) {
    // Tanpa dashboard: tulis state + snapshot dashboard berkala untuk
    // `status`/`stop` dan dashboard yang memantau daemon (`kcgcode`).
    const writeState = () => {
      const snapshot = takeSnapshot(info, "background");
      return writeDaemonState({
        pid: process.pid,
        port: info.port,
        hostname,
        localUrl: localUrl(info.port),
        publicUrl: snapshot.publicUrl,
        startedAt: snapshot.startedAt,
        logFile: daemonLogPath(),
        snapshot,
      });
    };
    await writeState();
    stateTimer = setInterval(() => void writeState(), DAEMON_STATE_MS);
    // Terminal asal ditutup tidak boleh menghentikan server.
    process.on("SIGHUP", () => {});
    console.log(`kcgcode running in background · pid ${process.pid} · ${localUrl(info.port)}`);
  } else {
    // `info` dimutasi saat restart port; dashboard membacanya ulang tiap render.
    dash = await startDashboard(() => takeSnapshot(info), {
      onQuit: (reason) => void shutdown(reason),
      onOpenUrl: () => openBrowser(localUrl(info.port)),
      onChangePort: changePort,
      onBackground: () => void moveToBackground(),
    });

    if (args.open) {
      void openBrowser(localUrl(info.port));
    }
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

export interface InitResult {
  created: boolean;
  configPath: string;
  sandboxPath: string;
  dataDir: string;
}

/** Scaffold config + folder sandbox/data. Config yang sudah ada tidak ditimpa. */
export function initConfig(args: Pick<CliArgs, "config">): InitResult {
  if (isCliMode()) ensureKcgHome();

  const configPath = resolveEffectiveConfigPath(args.config);
  const sandboxPath = args.config
    ? path.join(path.dirname(configPath), "sandbox")
    : defaultSandboxDir();
  const dataDir = path.dirname(resolveEffectiveDbPath());

  if (existsSync(configPath)) return { created: false, configPath, sandboxPath, dataDir };

  mkdirSync(path.dirname(configPath), { recursive: true });
  mkdirSync(sandboxPath, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  const body = `${JSON.stringify({ sandboxRoot: sandboxPath }, null, 2)}\n`;
  writeFileSync(configPath, body, "utf8");
  return { created: true, configPath, sandboxPath, dataDir };
}

export function runInit(args: CliArgs): void {
  const { created, configPath, sandboxPath, dataDir } = initConfig(args);

  if (!created) {
    console.log(
      panel("INIT", [
        row("Config", c.yellow("already exists — skipped")),
        row("Path", c.dim(configPath)),
        row("Mode", c.dim(isCliMode() ? "cli (~/.kcgcode)" : "dev (local)")),
        row("Home", c.dim(KCG_HOME)),
        "",
        c.dim("Edit sandboxRoot in the config if needed."),
      ]),
    );
    return;
  }

  console.log(
    panel("INIT", [
      row("Config", c.greenBright(`${symbols.check} created`)),
      row("Path", c.white(configPath)),
      row("Sandbox", c.white(sandboxPath)),
      row("Data", c.dim(dataDir)),
      row("Mode", c.dim(isCliMode() ? "cli (~/.kcgcode)" : "dev (local)")),
      "",
      c.dim(
        isCliMode()
          ? `Run ${c.cyan("kcgcode")} to start the dashboard.`
          : `Run ${c.cyan("bun dev")} in the project, or ${c.cyan("kcgcode")} if installed globally.`,
      ),
    ]),
  );
}

/**
 * Lupa PIN/password: hapus kunci aplikasi & cabut semua sesi langsung di
 * database lokal. Hanya bisa dijalankan dari mesin ini (akses shell), jadi
 * aman sebagai jalur pemulihan. Nickname & foto profil tidak diubah;
 * langganan notifikasi push semua perangkat dihapus.
 */
export function runResetLock(): void {
  const dbPath = resolveEffectiveDbPath();
  if (!existsSync(dbPath)) {
    console.log(`${c.dim("No database at")} ${c.cyan(dbPath)} ${c.dim("— nothing to reset.")}`);
    return;
  }
  const store = openSessionStore(dbPath);
  try {
    const wasLocked = store.getAuthSettings(Date.now()).lockKind !== null;
    createAuthService({ store }).resetLock();
    // Perangkat yang dulu berlangganan push ikut dilepas — notifikasi
    // memuat judul Session, jadi tak boleh terus mengalir ke perangkat lama.
    store.deleteAllPushSubscriptions();
    console.log(
      wasLocked
        ? `${c.greenBright(symbols.check)} App lock removed, all devices signed out and push notifications turned off.`
        : `${c.greenBright(symbols.check)} App was not locked. All device sessions and push subscriptions cleared.`,
    );
    console.log(
      `${c.dim("Set a new PIN or password in")} ${c.cyan("Settings → Security")}${c.dim(".")}`,
    );
    console.log(
      `${c.yellow("!")} ${c.dim("If KCG Code is running, anyone who can reach it can use it until you set a new lock.")}`,
    );
  } finally {
    store.close();
  }
}
