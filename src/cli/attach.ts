/**
 * Dashboard untuk server yang sudah jalan di background (daemon).
 *
 * Data dibaca dari `daemon.json` yang ditulis daemon tiap beberapa detik;
 * kontrol lewat sinyal (stop) atau spawn ulang daemon (ganti port).
 * Menutup dashboard (q) tidak menghentikan server.
 */
import { saveConfigPort } from "../config";
import type { CliArgs } from "./args";
import { type DaemonState, isAlive, readDaemonState, startDetached, stopDaemon } from "./daemon";
import { type DashboardSnapshot, openBrowser, startDashboard } from "./dashboard";
import { portIsFree } from "./port";
import { c, centerBlock, readPackageVersion, symbols } from "./theme";
import { updateNotice } from "./update-notice";

const POLL_MS = 1000;

/** Snapshot minimal untuk state daemon versi lama (tanpa `snapshot`). */
export function snapshotFromState(state: DaemonState): DashboardSnapshot {
  const target = state.publicUrl
    ? { label: "public", url: state.publicUrl }
    : { label: "local", url: state.localUrl };
  return {
    mode: "background",
    port: state.port,
    pid: state.pid,
    memory: "—",
    startedAt: state.startedAt,
    localUrl: state.localUrl,
    networkUrl: null,
    target,
    publicUrl: state.publicUrl,
    tunnel: { text: state.publicUrl ? "online" : "—", color: state.publicUrl ? "green" : "gray" },
    pairingUri: null,
    tunnelDetail: {
      provider: null,
      kcg: { phase: "—", url: null },
      lhr: null,
    },
    keepAwake: null,
    sessions: 0,
    running: 0,
    projects: 0,
    portNote: null,
    restarting: false,
  };
}

function hints(): string {
  return `${c.cyan("kcgcode")} ${c.dim("to reopen ·")} ${c.cyan("kcgcode stop")} ${c.dim("to stop")}`;
}

/**
 * Tampilkan dashboard untuk daemon yang berjalan. Hanya resolve bila user
 * memilih "Run in foreground" — daemon sudah dihentikan, dan nilai yang
 * dikembalikan adalah port yang dipakai daemon (untuk diteruskan pemanggil).
 */
export async function attachToDaemon(
  args: CliArgs,
  configPath: string,
  initial: DaemonState,
): Promise<number> {
  let current = initial;
  let busyLabel: string | null = null;
  // Versi paket terpasang — bisa lebih baru dari daemon yang berjalan.
  const installed = await readPackageVersion();

  const source = (): DashboardSnapshot => {
    const base = current.snapshot ?? snapshotFromState(current);
    return { ...base, mode: "background", restarting: busyLabel !== null, busyLabel };
  };

  return new Promise<number>((resolve) => {
    let dash: { stop(): void } | null = null;
    let poller: ReturnType<typeof setInterval> | null = null;

    const leave = (lines: string[], code = 0): never => {
      if (poller) clearInterval(poller);
      dash?.stop();
      // Ditengahkan seperti dashboard yang baru ditutup.
      console.log(centerBlock(lines.join("\n")));
      process.exit(code);
    };

    // Ikuti state terbaru; bila daemon mati di luar kendali dashboard, keluar.
    poller = setInterval(async () => {
      if (busyLabel) return;
      const state = await readDaemonState();
      if (state && state.pid === current.pid && isAlive(state.pid)) {
        current = state;
      } else if (!isAlive(current.pid)) {
        leave([`${c.yellow(symbols.warn)} kcgcode background server has stopped.`]);
      }
    }, POLL_MS);

    const respawn = (port: number) => startDetached({ ...args, port, detach: true });

    void startDashboard(source, {
      onQuit: () => {
        const update = current.snapshot?.update;
        leave([
          `${c.greenBright(symbols.check)} Dashboard closed — kcgcode keeps running in background.`,
          `  ${hints()}`,
          ...(update ? [updateNotice(update, installed)] : []),
        ]);
      },
      onOpenUrl: () => openBrowser(source().localUrl),
      onStop: async () => {
        busyLabel = "Stopping…";
        const result = await stopDaemon(current);
        leave([
          result === "killed"
            ? `${c.yellow(symbols.warn)} kcgcode force-killed (did not exit within 10s).`
            : `${c.greenBright(symbols.check)} kcgcode stopped.`,
        ]);
      },
      onForeground: async () => {
        busyLabel = "Moving to this terminal…";
        await stopDaemon(current);
        if (poller) clearInterval(poller);
        dash?.stop();
        resolve(current.port);
      },
      onChangePort: async (next) => {
        if (next !== current.port && !(await portIsFree(current.hostname, next))) {
          return `Port ${next} is already in use`;
        }
        const saved = saveConfigPort(configPath, next);
        if (!saved.ok) return saved.error;
        if (next === current.port) return null;

        const prev = current.port;
        busyLabel = "Restarting…";
        try {
          await stopDaemon(current);
          try {
            current = await respawn(next);
            return null;
          } catch (err) {
            // Gagal di port baru → hidupkan lagi di port lama.
            current = await respawn(prev);
            return `Cannot start on port ${next}: ${(err as Error).message}`;
          }
        } catch (err) {
          leave(
            [
              `${c.redBright(symbols.cross)} ${(err as Error).message}`,
              `  ${c.dim("Server is stopped. Run")} ${c.cyan("kcgcode")} ${c.dim("to start again.")}`,
            ],
            1,
          );
          return null;
        } finally {
          busyLabel = null;
        }
      },
    }).then((d) => {
      dash = d;
    });
  });
}
