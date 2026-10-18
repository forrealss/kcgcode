/**
 * Supervisor dev server per Project untuk fitur Preview.
 *
 * kcgcode — bukan agent — yang memegang proses dev server: background shell
 * milik agent ikut mati saat turn/sesi selesai, sedangkan preview harus
 * tetap hidup selama dibuka dari HP.
 *
 * - Satu proses per Project, dijalankan sebagai process group sendiri
 *   (`detached`) agar stop/restart ikut mematikan anak-anaknya (esbuild,
 *   watcher) — tidak ada proses yatim.
 * - Port: `port` di launch.json adalah jawaban pasti. Tanpanya, `PORT` diisi
 *   port kosong (Next/CRA/Bun membacanya) dan port nyata dideteksi dari URL
 *   PERTAMA di log (Vite, Next, dst.) — URL berikutnya sering listener lain
 *   (API internal, HMR, Network) — lalu dikonfirmasi lewat koneksi TCP.
 * - Log disimpan di buffer bergulir (dibaca UI lewat `?from=`).
 * - Perubahan fase/port dilaporkan lewat `onChange` (broadcast WS).
 * - Server yang dijalankan agent sendiri bisa diadopsi (`adopt`) agar tetap
 *   bisa di-preview; prosesnya bukan milik kcgcode, jadi hanya dipantau.
 * - Berhenti sendiri setelah idle: tanpa request preview & tanpa koneksi
 *   WebSocket (HMR) terbuka selama `idleMs` — laptop yang ditinggal tidak
 *   terus menjalankan dev server.
 */

import type { DevServerPhase, DevServerStatus } from "../../../types";
import type { Result } from "../../result";
import { TunnelLogBuffer } from "../tunnel/log-buffer";
import { formatCommand, type LaunchConfig } from "./launch-config";

export type { DevServerPhase, DevServerStatus };

/** Proses minimal (di-mock pada test). */
export interface DevProcessLike {
  pid: number;
  exited: Promise<number | null>;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  /** Kirim sinyal ke seluruh process group. */
  kill(signal: "SIGTERM" | "SIGKILL"): void;
}

export interface DevServerManagerOptions {
  spawn?: (cfg: LaunchConfig, env: Record<string, string>) => DevProcessLike;
  /** Host loopback yang menerima koneksi di `port`, atau null. */
  probe?: (port: number) => Promise<string | null>;
  /** Port kosong untuk env `PORT`. */
  freePort?: () => Promise<number>;
  now?: () => number;
  /** Interval cek kesiapan port (ms). */
  pollMs?: number;
  /** Batas tunggu sampai server siap (ms). */
  readyTimeoutMs?: number;
  /** Fase / port dev server berubah. */
  onChange?: (projectId: string, status: DevServerStatus) => void;
  /** Hentikan setelah idle selama ini (ms); 0 = tidak pernah. */
  idleMs?: number;
  /** Interval cek idle (ms). */
  idleCheckMs?: number;
  /** Interval cek server adopsi masih hidup (ms). */
  externalPollMs?: number;
}

/** Idle default: env `KCG_PREVIEW_IDLE_MIN` (menit, 0 = mati), default 30. */
export function resolveIdleMs(): number {
  const raw = process.env.KCG_PREVIEW_IDLE_MIN;
  const n = raw === undefined || raw.trim() === "" ? 30 : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n * 60_000 : 30 * 60_000;
}

export interface DevServerManager {
  status(projectId: string): DevServerStatus | null;
  /** Start (atau restart bila sudah berjalan). */
  start(projectId: string, cfg: LaunchConfig): Promise<Result<DevServerStatus>>;
  stop(projectId: string): Promise<DevServerStatus | null>;
  logs(projectId: string, from: number): { lines: string[]; next: number };
  /** Alamat upstream dev server yang siap, untuk proxy preview. */
  upstream(projectId: string): { host: string; port: number } | null;
  /**
   * Preview server yang dijalankan agent di `port` (bila Project belum punya
   * dev server hidup & port menerima koneksi). true = diadopsi.
   */
  adopt(projectId: string, port: number): Promise<boolean>;
  /** Ada request preview (menunda idle stop). */
  touch(projectId: string): void;
  /** Koneksi WebSocket preview (HMR) dibuka / ditutup. */
  connectionOpened(projectId: string): void;
  connectionClosed(projectId: string): void;
  shutdown(): Promise<void>;
}

const STOP_GRACE_MS = 3000;

// URL lokal yang dicetak dev server: "Local: http://localhost:5173/".
const URL_PORT_RE =
  /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})\b/;

/** Port dari satu baris log dev server, atau null. */
export function detectPortFromLine(line: string): number | null {
  const m = line.match(URL_PORT_RE);
  if (!m) return null;
  const port = Number(m[1]);
  return port > 0 && port <= 65535 ? port : null;
}

async function tcpAccepts(host: string, port: number): Promise<boolean> {
  const attempt = Bun.connect({
    hostname: host,
    port,
    socket: { data() {}, open: (s) => void s.end() },
  }).then(
    (s) => {
      s.end();
      return true;
    },
    () => false,
  );
  return Promise.race([attempt, Bun.sleep(1000).then(() => false)]);
}

/** Dev server modern bisa listen hanya di `::1` (Node `localhost`). */
async function defaultProbe(port: number): Promise<string | null> {
  if (await tcpAccepts("127.0.0.1", port)) return "127.0.0.1";
  if (await tcpAccepts("::1", port)) return "::1";
  return null;
}

async function defaultFreePort(): Promise<number> {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = probe.port ?? 0;
  probe.stop(true);
  return port;
}

function defaultSpawn(cfg: LaunchConfig, env: Record<string, string>): DevProcessLike {
  const proc = Bun.spawn(cfg.argv, {
    cwd: cfg.cwd,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
    detached: true,
  });
  return {
    pid: proc.pid,
    exited: proc.exited,
    stdout: proc.stdout,
    stderr: proc.stderr,
    kill: (signal) => {
      try {
        // Pid negatif = seluruh process group (POSIX).
        if (process.platform === "win32") proc.kill(signal);
        else process.kill(-proc.pid, signal);
      } catch {
        // sudah mati
      }
    },
  };
}

function drain(stream: ReadableStream<Uint8Array>, onLine: (l: string) => void): void {
  void (async () => {
    const decoder = new TextDecoder();
    let buf = "";
    try {
      for await (const chunk of stream) {
        buf += decoder.decode(chunk, { stream: true });
        const parts = buf.split(/\r?\n|\r/);
        buf = parts.pop() ?? "";
        for (const p of parts) onLine(p);
      }
    } catch {
      // stream ditutup
    }
    if (buf) onLine(buf);
  })();
}

interface Entry {
  projectId: string;
  /** null = server adopsi (proses milik agent). */
  proc: DevProcessLike | null;
  status: DevServerStatus;
  host: string | null;
  logs: TunnelLogBuffer;
  /** `port` dari launch.json (pasti) atau port server adopsi. */
  declaredPort: number | null;
  /** Port dari URL di log, urut kemunculan. */
  logPorts: number[];
  /** Port yang diisikan ke env `PORT`. */
  envPort: number | null;
  stopping: boolean;
  timer: ReturnType<typeof setInterval> | null;
  lastActive: number;
  connections: number;
}

export function createDevServerManager(opts: DevServerManagerOptions = {}): DevServerManager {
  const spawn = opts.spawn ?? defaultSpawn;
  const probe = opts.probe ?? defaultProbe;
  const freePort = opts.freePort ?? defaultFreePort;
  const now = opts.now ?? Date.now;
  const pollMs = opts.pollMs ?? 500;
  const readyTimeoutMs = opts.readyTimeoutMs ?? 120_000;
  const idleMs = opts.idleMs ?? resolveIdleMs();
  const entries = new Map<string, Entry>();

  function emit(e: Entry): void {
    if (entries.get(e.projectId) !== e) return;
    try {
      opts.onChange?.(e.projectId, snapshot(e));
    } catch {
      // listener gagal tidak boleh mengganggu supervisor
    }
  }

  const idleTimer =
    idleMs > 0
      ? setInterval(() => {
          for (const e of entries.values()) {
            const live = e.status.phase === "starting" || e.status.phase === "running";
            if (!e.proc) continue; // server adopsi bukan milik kcgcode
            if (!live || e.connections > 0 || now() - e.lastActive < idleMs) continue;
            e.logs.write(
              `[kcgcode] Stopping after ${Math.round(idleMs / 60_000)} min without preview activity.`,
            );
            void stopEntry(e);
          }
        }, opts.idleCheckMs ?? 60_000)
      : null;
  // Jangan menahan proses tetap hidup hanya karena timer ini.
  if (idleTimer && typeof idleTimer === "object" && "unref" in idleTimer) idleTimer.unref();

  /** Urutan port yang dicoba: deklarasi saja, atau URL log lalu env PORT. */
  function probeOrder(e: Entry): number[] {
    if (e.declaredPort !== null) return [e.declaredPort];
    return e.envPort !== null && !e.logPorts.includes(e.envPort)
      ? [...e.logPorts, e.envPort]
      : e.logPorts;
  }

  function clearTimer(e: Entry): void {
    if (e.timer) clearInterval(e.timer);
    e.timer = null;
  }

  function watchReady(e: Entry): void {
    let busy = false;
    e.timer = setInterval(async () => {
      if (busy || e.status.phase !== "starting") return;
      busy = true;
      try {
        for (const port of probeOrder(e)) {
          const host = await probe(port);
          if (host && e.status.phase === "starting") {
            e.status.phase = "running";
            e.status.port = port;
            e.host = host;
            e.logs.write(`[kcgcode] Dev server ready on port ${port}.`);
            clearTimer(e);
            emit(e);
            return;
          }
        }
        if (now() - e.status.startedAt > readyTimeoutMs) {
          e.logs.write(
            e.declaredPort !== null
              ? `[kcgcode] Nothing is listening on port ${e.declaredPort} (from launch.json) yet. Check the config.`
              : "[kcgcode] No port detected yet; still watching the log.",
          );
          clearTimer(e);
        }
      } finally {
        busy = false;
      }
    }, pollMs);
  }

  async function stopEntry(e: Entry): Promise<void> {
    if (e.status.phase !== "starting" && e.status.phase !== "running") return;
    e.stopping = true;
    clearTimer(e);
    if (!e.proc) {
      // Server milik agent: lepaskan saja, prosesnya tidak disentuh.
      e.status.phase = "stopped";
      e.status.port = null;
      e.host = null;
      e.logs.write("[kcgcode] Stopped previewing the agent's server (it keeps running).");
      emit(e);
      return;
    }
    e.proc.kill("SIGTERM");
    const exited = await Promise.race([
      e.proc.exited.then(() => true),
      Bun.sleep(STOP_GRACE_MS).then(() => false),
    ]);
    if (!exited) {
      e.proc.kill("SIGKILL");
      await Promise.race([e.proc.exited, Bun.sleep(1000)]);
    }
  }

  async function start(projectId: string, cfg: LaunchConfig): Promise<Result<DevServerStatus>> {
    const prev = entries.get(projectId);
    if (prev) await stopEntry(prev);

    const envPort = cfg.port ?? (await freePort());
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    Object.assign(env, {
      PORT: String(envPort),
      // Jangan buka browser di mesin host & jangan cetak warna ke log.
      BROWSER: "none",
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    });

    let proc: DevProcessLike;
    try {
      proc = spawn(cfg, env);
    } catch (err) {
      return { ok: false, error: `PREVIEW_SPAWN_FAILED: ${String(err).slice(0, 200)}` };
    }

    const logs = new TunnelLogBuffer(() => []);
    const e: Entry = {
      projectId,
      proc,
      status: {
        phase: "starting",
        command: formatCommand(cfg.argv),
        port: null,
        startedAt: now(),
        exitCode: null,
        logOffset: 0,
      },
      host: null,
      logs,
      declaredPort: cfg.port,
      logPorts: [],
      envPort,
      stopping: false,
      timer: null,
      lastActive: now(),
      connections: 0,
    };
    entries.set(projectId, e);
    emit(e);
    logs.write(`[kcgcode] $ ${e.status.command}`);

    const onLine = (line: string) => {
      if (entries.get(projectId) !== e) return;
      logs.write(line);
      const port = detectPortFromLine(line);
      if (e.declaredPort === null && port !== null && !e.logPorts.includes(port)) {
        // URL di log lebih akurat daripada PORT (mis. Vite pindah ke 5174);
        // yang pertama dicetak biasanya app-nya.
        e.logPorts.push(port);
        if (e.status.phase === "starting" && !e.timer) watchReady(e);
      }
    };
    drain(proc.stdout, onLine);
    drain(proc.stderr, onLine);
    watchReady(e);

    void proc.exited.then((code) => {
      if (entries.get(projectId) !== e) return;
      clearTimer(e);
      e.status.exitCode = code;
      e.status.port = null;
      e.host = null;
      if (e.stopping) {
        e.status.phase = "stopped";
        logs.write("[kcgcode] Dev server stopped.");
      } else {
        e.status.phase = code === 0 ? "exited" : "crashed";
        logs.write(`[kcgcode] Dev server exited (code ${code ?? "?"}).`);
      }
      emit(e);
    });

    return { ok: true, data: snapshot(e) };
  }

  function snapshot(e: Entry): DevServerStatus {
    return { ...e.status, logOffset: e.logs.total };
  }

  return {
    status(projectId) {
      const e = entries.get(projectId);
      return e ? snapshot(e) : null;
    },
    start,
    async stop(projectId) {
      const e = entries.get(projectId);
      if (!e) return null;
      await stopEntry(e);
      return snapshot(e);
    },
    logs(projectId, from) {
      return entries.get(projectId)?.logs.read(from) ?? { lines: [], next: 0 };
    },
    upstream(projectId) {
      const e = entries.get(projectId);
      if (e?.status.phase !== "running" || e.status.port === null || !e.host) return null;
      return { host: e.host, port: e.status.port };
    },
    async adopt(projectId, port) {
      const live = (s: Entry | undefined) =>
        s?.status.phase === "starting" || s?.status.phase === "running";
      if (live(entries.get(projectId))) return false;
      const host = await probe(port);
      if (!host || live(entries.get(projectId))) return false;
      const logs = new TunnelLogBuffer(() => []);
      const e: Entry = {
        projectId,
        proc: null,
        status: {
          phase: "running",
          command: `Started by the agent on :${port}`,
          port,
          startedAt: now(),
          exitCode: null,
          logOffset: 0,
          external: true,
        },
        host,
        logs,
        declaredPort: port,
        logPorts: [],
        envPort: null,
        stopping: false,
        timer: null,
        lastActive: now(),
        connections: 0,
      };
      entries.set(projectId, e);
      logs.write(
        `[kcgcode] Found a dev server the agent started on port ${port}. Its output stays with the agent.`,
      );
      let busy = false;
      e.timer = setInterval(async () => {
        if (busy || e.status.phase !== "running") return;
        busy = true;
        try {
          if (await probe(port)) return;
          clearTimer(e);
          e.status.phase = "exited";
          e.status.port = null;
          e.host = null;
          logs.write("[kcgcode] The agent's dev server stopped.");
          emit(e);
        } finally {
          busy = false;
        }
      }, opts.externalPollMs ?? 5000);
      emit(e);
      return true;
    },
    touch(projectId) {
      const e = entries.get(projectId);
      if (e) e.lastActive = now();
    },
    connectionOpened(projectId) {
      const e = entries.get(projectId);
      if (e) {
        e.connections++;
        e.lastActive = now();
      }
    },
    connectionClosed(projectId) {
      const e = entries.get(projectId);
      if (e) {
        e.connections = Math.max(0, e.connections - 1);
        e.lastActive = now();
      }
    },
    async shutdown() {
      if (idleTimer) clearInterval(idleTimer);
      await Promise.all([...entries.values()].map(stopEntry));
    },
  };
}
