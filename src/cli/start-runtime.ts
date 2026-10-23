/**
 * Daur hidup server yang berjalan: boot server, pasang keep-awake, lalu jalan
 * sebagai anak daemon (tulis state berkala) atau dengan dashboard interaktif.
 * Juga menangani ganti port, pindah ke background, dan shutdown rapi.
 *
 * Dipisah dari `commands.ts` (`runStart`) karena bagian ini saling bergantung
 * lewat state mutable (`app`, `info`, `keepAwake`) — dikurung dalam satu
 * `runServer` agar fase setup di `runStart` tetap ringkas & terbaca.
 */
import { type AppConfig, saveConfigPort } from "../config";
import spa from "../index.html";
import { SPA_PATHS } from "../lib/routes";
import { resolveEffectiveUploadsDir, WEB_DIST_DIR } from "../paths";
import { createKcgServer } from "../server/app";
import { loadPrebuiltWeb } from "../server/prebuilt-web";
import type { CliArgs } from "./args";
import {
  clearDaemonState,
  daemonLogPath,
  printStarted,
  startDetached,
  writeDaemonState,
} from "./daemon";
import { type DashboardInfo, openBrowser, startDashboard, takeSnapshot } from "./dashboard";
import { disabledKeepAwake, startKeepAwake } from "./keep-awake";
import { portIsFree } from "./port";
import { c, centerBlock, symbols } from "./theme";
import { updateNotice } from "./update-notice";

/** Interval daemon menulis state + snapshot dashboard. */
const DAEMON_STATE_MS = 2000;

export interface RunServerOptions {
  args: CliArgs;
  config: AppConfig;
  hostname: string;
  /** Port final yang sudah dipilih (`choosePort`). */
  port: number;
  /** Catatan fallback port (mis. "3000 in use"), null bila port asli dipakai. */
  portNote: string | null;
  /** Proses ini adalah anak daemon (jalan tanpa dashboard). */
  daemonChild: boolean;
}

export async function runServer(opts: RunServerOptions): Promise<void> {
  const { args, config, hostname, port, portNote, daemonChild } = opts;

  // Paket npm membawa frontend prebuilt; checkout git jatuh ke bundling runtime.
  const web = loadPrebuiltWeb(WEB_DIST_DIR);
  const boot = (p: number) =>
    createKcgServer({
      config,
      spa: web?.spa ?? spa,
      assets: web?.assets,
      spaPaths: SPA_PATHS,
      port: p,
      hostname,
      uploadsRoot: resolveEffectiveUploadsDir(),
    });
  const localUrl = (p: number) =>
    `http://${hostname === "0.0.0.0" || hostname === "::" ? "localhost" : hostname}:${p}`;

  let app = boot(port);
  const info: DashboardInfo = {
    server: app,
    port: app.server.port ?? port,
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
