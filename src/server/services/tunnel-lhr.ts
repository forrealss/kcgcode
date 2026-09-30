/**
 * Tunnel localhost.run — akses publik gratis tanpa akun lewat SSH
 * (`ssh -R 80:<host>:<port> nokey@localhost.run -- --output json`).
 *
 * - Tidak butuh biner tambahan: memakai `ssh` bawaan OS.
 * - `--output json`: tiap event berupa satu baris JSON di stdout. Event
 *   `tcpip-forward` dengan `authz_code: "OK"` membawa `address`
 *   (`<acak>.lhr.life`) — alamat publik HTTPS tunnel.
 * - Domain gratis BERUBAH tiap sambung ulang / setelah beberapa jam: status
 *   selalu membawa alamat terbaru, UI menampilkannya apa adanya.
 * - `ServerAliveInterval` + `ExitOnForwardFailure`: koneksi mati terdeteksi
 *   cepat lalu disambung ulang dengan backoff (pola sama dengan frpc).
 * - Wajib app lock (alamat publik); kunci dihapus -> tunnel dimatikan.
 *
 * Host key: `StrictHostKeyChecking=accept-new` + `UserKnownHostsFile` khusus
 * di direktori data kcgcode (tidak menyentuh `~/.ssh/known_hosts` pengguna).
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { SessionStore } from "../../db";
import type { Result } from "../result";
import { frpcLocalIp, type TunnelPhase } from "./tunnel";

export interface LhrStatus {
  phase: Exclude<TunnelPhase, "signed_out">;
  enabled: boolean;
  /** Alamat publik saat ini (`https://<acak>.lhr.life`), null bila belum ada. */
  url: string | null;
  error: string | null;
  logOffset: number;
}

/** Proses ssh minimal (di-mock pada test). */
export interface SshProcessLike {
  pid?: number;
  exited: Promise<number | null>;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  kill(signal?: "SIGTERM" | "SIGKILL"): void;
}

export interface LhrManagerOptions {
  store: SessionStore;
  localPort: number;
  localHost: string;
  /** Direktori data kcgcode (untuk known_hosts khusus). */
  dataDir: string;
  isProtected: () => boolean;
  spawn?: (args: string[]) => SshProcessLike;
  now?: () => number;
  backoff?: (attempt: number) => number;
  /** Ada tidaknya `ssh` di PATH (di-override test). */
  hasSsh?: () => boolean;
}

export interface LhrManager {
  status(): LhrStatus;
  logs(from: number): { lines: string[]; next: number };
  start(): Promise<Result<LhrStatus>>;
  stop(): Promise<LhrStatus>;
  handleLockChanged(protectedNow: boolean): void;
  autoStart(): void;
  shutdown(): Promise<void>;
}

const MAX_LOG_LINES = 300;
const ADDRESS_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.(lhr\.life|localhost\.run)$/i;

/** Argumen `ssh` untuk tunnel HTTP localhost.run (murni, diuji). */
export function buildSshArgs(p: { localIp: string; localPort: number; knownHosts: string }) {
  return [
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    `UserKnownHostsFile=${p.knownHosts}`,
    "-o",
    "ServerAliveInterval=30",
    "-o",
    "ServerAliveCountMax=3",
    "-o",
    "ExitOnForwardFailure=yes",
    "-R",
    `80:${p.localIp}:${p.localPort}`,
    "nokey@localhost.run",
    "--",
    "--output",
    "json",
  ];
}

export type LhrEvent =
  | { kind: "online"; address: string }
  | { kind: "denied"; message: string }
  | { kind: "info"; message: string }
  | null;

/**
 * Tafsirkan satu baris stdout ssh (`--output json`). Baris non-JSON (mis.
 * header "tunnel config: ...") -> null. Alamat divalidasi ketat agar server
 * tidak bisa menyuntikkan URL sembarang ke UI.
 */
export function parseLhrLine(line: string): LhrEvent {
  const t = line.trim();
  if (!t.startsWith("{")) return null;
  let ev: Record<string, unknown>;
  try {
    ev = JSON.parse(t) as Record<string, unknown>;
  } catch {
    return null;
  }
  // Format CloudEvents (dipakai sebagian server localhost.run):
  // `type: "v1.tcpip_forward.register.accepted"`, `id: "localhost/<alamat>"`.
  if (typeof ev.type === "string" && ev.type.includes("tcpip_forward")) {
    const data = typeof ev.data === "string" ? ev.data : "";
    if (ev.type.endsWith(".accepted")) {
      const fromId = typeof ev.id === "string" ? (ev.id.split("/").pop() ?? "") : "";
      const address = ADDRESS_RE.test(fromId) ? fromId : (data.split(/[\s,]/)[0] ?? "");
      if (ADDRESS_RE.test(address)) return { kind: "online", address: address.toLowerCase() };
    }
    return { kind: "denied", message: data.split(/\r?\n/)[0] || ev.type };
  }
  if (ev.event === "tcpip-forward") {
    const address = typeof ev.address === "string" ? ev.address : "";
    if (ev.authz_code === "OK" && ADDRESS_RE.test(address)) {
      return { kind: "online", address: address.toLowerCase() };
    }
    return { kind: "denied", message: typeof ev.message === "string" ? ev.message : "denied" };
  }
  // Pesan pertama saja (baris pertama) — isi lain berupa QR kode ANSI.
  const raw =
    typeof ev.message === "string" ? ev.message : typeof ev.data === "string" ? ev.data : "";
  const message = raw.split(/\r?\n/)[0] ?? "";
  return message ? { kind: "info", message } : null;
}

const DEFAULT_SPAWN = (args: string[]): SshProcessLike => {
  const proc = Bun.spawn(["ssh", ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    pid: proc.pid,
    exited: proc.exited,
    stdout: proc.stdout,
    stderr: proc.stderr,
    kill: (signal) => proc.kill(signal),
  };
};

export function createLhrManager(opts: LhrManagerOptions): LhrManager {
  const { store } = opts;
  const now = opts.now ?? Date.now;
  const spawn = opts.spawn ?? DEFAULT_SPAWN;
  const backoff = opts.backoff ?? ((n: number) => Math.min(60_000, 3000 * 2 ** n));
  const hasSsh = opts.hasSsh ?? (() => Bun.which("ssh") !== null);
  const knownHosts = path.join(opts.dataDir, "lhr_known_hosts");

  let phase: LhrStatus["phase"] = "stopped";
  let url: string | null = null;
  let lastError: string | null = null;
  let proc: SshProcessLike | null = null;
  let stopping = false;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let chain: Promise<unknown> = Promise.resolve();

  const lines: string[] = [];
  let total = 0;

  function log(line: string): void {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: buang kode warna ANSI
    const clean = line.replace(/\u001b\[[0-9;]*m/g, "").trimEnd();
    if (clean === "") return;
    lines.push(clean);
    if (lines.length > MAX_LOG_LINES) lines.splice(0, lines.length - MAX_LOG_LINES);
    total++;
  }

  function serialize<T>(fn: () => Promise<T>): Promise<T> {
    const p = chain.then(fn, fn);
    chain = p.catch(() => {});
    return p;
  }

  function enabled(): boolean {
    return store.getTunnelSettings(now()).lhrEnabled;
  }

  function status(): LhrStatus {
    return { phase, enabled: enabled(), url, error: lastError, logOffset: total };
  }

  function clearRestart(): void {
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = null;
  }

  async function killProc(): Promise<void> {
    const p = proc;
    proc = null;
    if (!p) return;
    stopping = true;
    try {
      p.kill("SIGTERM");
      const done = await Promise.race([
        p.exited.then(() => true),
        Bun.sleep(3000).then(() => false),
      ]);
      if (!done) p.kill("SIGKILL");
    } catch {
      /* sudah mati */
    } finally {
      stopping = false;
    }
  }

  function drain(stream: ReadableStream<Uint8Array>, onLine: (l: string) => void): void {
    void (async () => {
      const decoder = new TextDecoder();
      let buf = "";
      try {
        for await (const chunk of stream) {
          buf += decoder.decode(chunk, { stream: true });
          const parts = buf.split(/\r?\n/);
          buf = parts.pop() ?? "";
          for (const part of parts) onLine(part);
        }
      } catch {
        /* stream ditutup */
      }
      if (buf) onLine(buf);
    })();
  }

  function launch(): Result<null> {
    if (!opts.isProtected()) return { ok: false, error: "TUNNEL_LOCK_REQUIRED" };
    if (!hasSsh()) return { ok: false, error: "LHR_SSH_MISSING" };
    mkdirSync(opts.dataDir, { recursive: true });

    let p: SshProcessLike;
    try {
      p = spawn(
        buildSshArgs({
          localIp: frpcLocalIp(opts.localHost),
          localPort: opts.localPort,
          knownHosts,
        }),
      );
    } catch (e) {
      log(`Failed to start ssh: ${(e as Error).message}`);
      return { ok: false, error: "LHR_START_FAILED" };
    }
    proc = p;
    phase = "connecting";
    url = null;
    log("Connecting to localhost.run…");

    let denied = false;
    drain(p.stdout, (l) => {
      if (proc !== p) return;
      const ev = parseLhrLine(l);
      if (!ev) return;
      if (ev.kind === "online") {
        url = `https://${ev.address}`;
        phase = "online";
        attempt = 0;
        lastError = null;
        log(`Online → ${url}`);
      } else if (ev.kind === "denied") {
        denied = true;
        log(`Rejected by localhost.run: ${ev.message}`);
      } else {
        log(ev.message);
      }
    });
    // stderr berisi banner sambutan & pesan ssh — cukup dicatat.
    drain(p.stderr, (l) => {
      if (proc === p) log(l);
    });

    void p.exited.then((code) => {
      if (proc !== p || stopping) return;
      proc = null;
      url = null;
      log(`ssh exited (code ${code ?? "?"}).`);
      if (denied) {
        phase = "error";
        lastError = "LHR_DENIED";
        return;
      }
      if (!enabled() || !opts.isProtected()) {
        phase = "stopped";
        return;
      }
      phase = "reconnecting";
      const delay = backoff(attempt++);
      log(`Reconnecting in ${Math.round(delay / 1000)}s…`);
      clearRestart();
      restartTimer = setTimeout(() => {
        restartTimer = null;
        void serialize(async () => {
          if (proc || !enabled()) return;
          const r = launch();
          if (!r.ok) {
            phase = "error";
            lastError = r.error;
          }
        });
      }, delay);
      restartTimer.unref?.();
    });
    return { ok: true, data: null };
  }

  function start(): Promise<Result<LhrStatus>> {
    return serialize(async () => {
      if (!opts.isProtected()) return { ok: false, error: "TUNNEL_LOCK_REQUIRED" };
      clearRestart();
      await killProc();
      attempt = 0;
      lastError = null;
      store.setLhrEnabled(true, now());
      const r = launch();
      if (!r.ok) {
        phase = "error";
        lastError = r.error;
        return r;
      }
      return { ok: true, data: status() };
    });
  }

  function stop(): Promise<LhrStatus> {
    return serialize(async () => {
      store.setLhrEnabled(false, now());
      clearRestart();
      await killProc();
      phase = "stopped";
      url = null;
      log("Tunnel stopped.");
      return status();
    });
  }

  function handleLockChanged(protectedNow: boolean): void {
    if (protectedNow) return;
    if (!enabled() && !proc) return;
    log("App lock removed — tunnel turned off.");
    void stop().then(() => {
      lastError = "TUNNEL_LOCK_REQUIRED";
    });
  }

  function autoStart(): void {
    if (!enabled()) return;
    if (!opts.isProtected()) {
      store.setLhrEnabled(false, now());
      return;
    }
    void start().then((r) => {
      if (!r.ok) console.error(`[kcg-code] localhost.run gagal dinyalakan: ${r.error}`);
    });
  }

  async function shutdown(): Promise<void> {
    clearRestart();
    await serialize(() => killProc());
  }

  return {
    status,
    logs(from) {
      const first = total - lines.length;
      const startAt = Math.min(Math.max(from, first), total);
      return { lines: lines.slice(startAt - first), next: total };
    },
    start,
    stop,
    handleLockChanged,
    autoStart,
    shutdown,
  };
}
