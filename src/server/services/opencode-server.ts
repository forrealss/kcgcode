/**
 * OpenCode_Server — lifecycle proses `opencode serve` per Project.
 *
 * Satu instance `opencode serve` hanya dapat membuat Session di direktori
 * kerja (cwd) tempat ia dijalankan (terverifikasi: `POST /session` tidak
 * menerima field `directory`). Karena Project KCG Code bisa berbeda-beda
 * direktori, setiap Project mendapat satu server sendiri yang di-spawn di
 * `project.path` — menggantikan model "satu PTY per Session".
 *
 * - `--port 0` meminta port acak; port ditemukan dari baris log
 *   "opencode server listening on http://127.0.0.1:<port>" di stderr.
 * - stdout/stderr terus di-drain (buffer log bergulir) agar pipe tidak penuh
 *   dan memblokir proses server yang berumur panjang.
 * - `ensureServer` idempoten dan aman terhadap konkurensi (in-flight promise).
 * - Exit callback hanya dipanggil bila instance yang keluar masih instance
 *   aktif — instance pengganti tidak terpengaruh.
 */

import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Result } from "../result";
import type { OpenCodeClient, OpenCodeEvent } from "./opencode-client";
import { createOpenCodeClient } from "./opencode-client";

export interface OpenCodeServerHandle {
  projectId: string;
  baseUrl: string;
  client: OpenCodeClient;
}

/** Kontrak proses minimal (di-mock pada test). */
export interface ServerProcessLike {
  kill(signal: "SIGTERM" | "SIGKILL"): void;
  exited: Promise<number | null>;
  /** Stream stderr (untuk menemukan port). */
  stderr: ReadableStream<Uint8Array>;
  /** Stream stdout (di-drain agar tidak penuh). */
  stdout?: ReadableStream<Uint8Array>;
  /** PID proses (untuk SIGKILL fallback). */
  pid?: number;
}

export interface OpenCodeServerManagerOptions {
  /** Spawn `opencode serve` (injectable untuk test). */
  spawn?: (cwd: string) => ServerProcessLike;
  /** Factory client (injectable untuk test). */
  clientFactory?: (baseUrl: string) => OpenCodeClient;
  /** Batas waktu menunggu port tercetak di stderr (ms). */
  portTimeoutMs?: number;
  /** Batas waktu menunggu health (ms). */
  readyTimeoutMs?: number;
  /** Hook event SSE dari tiap server (diteruskan ke Session_Manager). */
  onEvent?: (projectId: string, ev: OpenCodeEvent) => void;
}

export interface OpenCodeServerManager {
  ensureServer(projectId: string, projectPath: string): Promise<Result<OpenCodeServerHandle>>;
  getServer(projectId: string): OpenCodeServerHandle | undefined;
  /**
   * Pastikan server hidup; bila file config opencode berubah sejak spawn
   * terakhir, server di-restart agar `/config/providers` (daftar model)
   * dan `/agent` ikut terbaca ulang — `opencode serve` tidak hot-reload.
   */
  ensureFreshServer(projectId: string, projectPath: string): Promise<Result<OpenCodeServerHandle>>;
  stopServer(projectId: string): Promise<void>;
  stopAll(): Promise<void>;
  /** Daftarkan hook saat server keluar tak terduga. */
  onServerExit(cb: (projectId: string) => void): void;
}

interface ServerInstance {
  handle: OpenCodeServerHandle;
  proc: ServerProcessLike;
  exiting: boolean;
  /** Fingerprint config opencode saat server di-spawn (deteksi perubahan). */
  configFingerprint: string;
}

/**
 * Path file config opencode yang memengaruhi provider/model/agent:
 * project (`opencode.json`/`opencode.jsonc`) + global user config.
 */
export function opencodeConfigPaths(projectPath: string): string[] {
  const home = homedir();
  return [
    join(projectPath, "opencode.json"),
    join(projectPath, "opencode.jsonc"),
    join(home, ".config", "opencode", "opencode.json"),
    join(home, ".config", "opencode", "opencode.jsonc"),
    join(home, ".opencode", "opencode.json"),
    join(home, ".opencode", "opencode.jsonc"),
  ];
}

/**
 * Fingerprint config: path:mtimeMs untuk tiap file yang ada. Bila nilainya
 * berbeda dari saat spawn, config dianggap berubah dan server perlu restart.
 */
export function configFingerprint(projectPath: string): string {
  const parts: string[] = [];
  for (const p of opencodeConfigPaths(projectPath)) {
    try {
      if (existsSync(p)) parts.push(`${p}:${statSync(p).mtimeMs}`);
    } catch {
      /* file hilang / tidak readable — lewati */
    }
  }
  return parts.join("|");
}

const DEFAULT_SPAWN: (cwd: string) => ServerProcessLike = (cwd) => {
  const proc = Bun.spawn(["opencode", "serve", "--port", "0", "--hostname", "127.0.0.1"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    kill: (signal) => proc.kill(signal as NodeJS.Signals),
    exited: proc.exited.then((code) => code),
    stderr: proc.stderr,
    stdout: proc.stdout,
    pid: proc.pid,
  };
};

/** Ekstrak port dari baris log stderr "listening on http://host:port". */
export function parseListeningPort(line: string): number | null {
  const m = line.match(/listening on http:\/\/[^:]+:(\d+)/);
  return m ? Number(m[1]) : null;
}

/** Poll `GET /global/health` hingga siap atau timeout. */
export async function waitHealth(client: OpenCodeClient, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await client.health()) return true;
    await Bun.sleep(300);
  }
  return false;
}

export function createOpenCodeServerManager(
  opts: OpenCodeServerManagerOptions = {},
): OpenCodeServerManager {
  const spawn = opts.spawn ?? DEFAULT_SPAWN;
  const clientFactory = opts.clientFactory ?? createOpenCodeClient;
  const portTimeoutMs = opts.portTimeoutMs ?? 30000;
  const readyTimeoutMs = opts.readyTimeoutMs ?? 60000;
  const onEvent = opts.onEvent;
  const instances = new Map<string, ServerInstance>();
  /** In-flight ensure agar dua panggilan paralel tidak men-spawn dua server. */
  const pending = new Map<string, Promise<Result<OpenCodeServerHandle>>>();
  const exitCbs = new Set<(projectId: string) => void>();

  function ensureServer(
    projectId: string,
    projectPath: string,
  ): Promise<Result<OpenCodeServerHandle>> {
    const existing = instances.get(projectId);
    if (existing && !existing.exiting) {
      return Promise.resolve({ ok: true, data: existing.handle });
    }
    const inflight = pending.get(projectId);
    if (inflight) return inflight;
    const p = startServer(projectId, projectPath).finally(() => pending.delete(projectId));
    pending.set(projectId, p);
    return p;
  }

  /**
   * Seperti `ensureServer`, tapi restart dulu bila fingerprint config
   * berubah. Restart adalah stop + ensure (in-flight aman terhadap
   * dua panggilan paralel lewat map `pending`).
   */
  async function ensureFreshServer(
    projectId: string,
    projectPath: string,
  ): Promise<Result<OpenCodeServerHandle>> {
    const existing = instances.get(projectId);
    if (existing && !existing.exiting) {
      if (existing.configFingerprint === configFingerprint(projectPath)) {
        return { ok: true, data: existing.handle };
      }
      await stopServer(projectId);
    }
    return ensureServer(projectId, projectPath);
  }

  async function startServer(
    projectId: string,
    projectPath: string,
  ): Promise<Result<OpenCodeServerHandle>> {
    let proc: ServerProcessLike;
    try {
      proc = spawn(projectPath);
    } catch (e) {
      return { ok: false, error: `SERVER_START_FAILED: ${(e as Error).message}` };
    }

    // ---- Drain stdout/stderr berkelanjutan + deteksi port dari stderr ----
    let serverLog = "";
    let port: number | null = null;
    let portResolved = false;
    let resolvePort: (p: number | null) => void = () => {};
    const portPromise = new Promise<number | null>((res) => {
      resolvePort = res;
    });
    const resolveOnce = (p: number | null): void => {
      if (!portResolved) {
        portResolved = true;
        resolvePort(p);
      }
    };

    const drain = (stream: ReadableStream<Uint8Array>): void => {
      const decoder = new TextDecoder();
      void (async () => {
        const reader = stream.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            resolveOnce(port);
            return;
          }
          const text = decoder.decode(value, { stream: true });
          serverLog = (serverLog + text).slice(-16000);
          if (port === null) {
            const found = parseListeningPort(text);
            if (found !== null) {
              port = found;
              resolveOnce(found);
            }
          }
        }
      })();
    };
    drain(proc.stderr);
    if (proc.stdout) drain(proc.stdout);

    const found = await Promise.race([
      portPromise,
      Bun.sleep(portTimeoutMs).then(() => {
        resolveOnce(port);
        return port;
      }),
    ]);
    if (found === null) {
      proc.kill("SIGKILL");
      return {
        ok: false,
        error: `SERVER_START_FAILED: port tidak ditemukan. Log:\n${serverLog.slice(-800)}`,
      };
    }

    const baseUrl = `http://127.0.0.1:${found}`;
    const client = clientFactory(baseUrl);
    if (!(await waitHealth(client, readyTimeoutMs))) {
      proc.kill("SIGKILL");
      return { ok: false, error: "SERVER_START_FAILED: health check gagal" };
    }

    const handle: OpenCodeServerHandle = { projectId, baseUrl, client };
    const instance: ServerInstance = {
      handle,
      proc,
      exiting: false,
      configFingerprint: configFingerprint(projectPath),
    };
    instances.set(projectId, instance);

    if (onEvent) {
      client.subscribeEvents((ev) => onEvent(projectId, ev));
    }

    // Server mati tak terduga: hanya bila instance ini masih yang aktif.
    void proc.exited.then(() => {
      if (instance.exiting) return;
      if (instances.get(projectId) !== instance) return; // sudah diganti — abaikan
      instances.delete(projectId);
      for (const cb of exitCbs) cb(projectId);
    });

    return { ok: true, data: handle };
  }

  async function stopServer(projectId: string): Promise<void> {
    const instance = instances.get(projectId);
    if (!instance) return;
    instance.exiting = true;
    instances.delete(projectId);
    instance.proc.kill("SIGTERM");
    await Promise.race([instance.proc.exited, Bun.sleep(3000)]);
    if (instance.proc.pid !== undefined) {
      try {
        Bun.spawnSync(["kill", "-9", String(instance.proc.pid)]);
      } catch {
        /* best effort */
      }
    } else {
      instance.proc.kill("SIGKILL");
    }
  }

  async function stopAll(): Promise<void> {
    await Promise.all([...instances.keys()].map((id) => stopServer(id)));
  }

  return {
    ensureServer,
    ensureFreshServer,
    getServer: (projectId) => instances.get(projectId)?.handle,
    stopServer,
    stopAll,
    onServerExit: (cb) => {
      exitCbs.add(cb);
    },
  };
}
