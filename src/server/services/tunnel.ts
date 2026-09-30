/**
 * Tunnel_Manager — akses publik `https://<username>.<domain>` lewat
 * kcgcode-rp (API di VPS) + frpc.
 *
 * Alur (device authorization, mirip `gh auth login` / RFC 8628):
 * 1. `connect()` — `POST /device/start` -> `user_code` + URL verifikasi.
 *    Pengguna membuka URL di perangkat mana pun, login Google & (pengguna
 *    baru) memilih nama di VPS, lalu menyetujui perangkat ini secara eksplisit.
 * 2. Manager mem-poll `/device/token` (hormati `interval` & `slow_down`)
 *    sampai disetujui -> device_token + subdomain + tunnel_secret disimpan.
 *    Tidak ada kredensial Google di kcgcode sama sekali.
 * 3. `start()` — wajib app lock aktif. Ambil `frpc.toml` dari VPS, tapi config
 *    yang dijalankan DIBANGUN ULANG di sini (hanya serverAddr/serverPort yang
 *    diambil dari VPS) agar VPS tidak bisa menyisipkan proxy/plugin lain
 *    (mis. `static_file`). File ditulis mode 0600.
 * 4. frpc diawasi: status dari log, restart dengan backoff, berhenti permanen
 *    bila ditolak server. Kunci dihapus -> tunnel dimatikan. Device dicabut di
 *    VPS -> akun lokal dilupakan.
 *
 * Token & secret tidak pernah keluar lewat `status()` (dikirim ke browser).
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname as osHostname } from "node:os";
import path from "node:path";
import type { SessionStore } from "../../db";
import type { TunnelAccount } from "../db/tunnel";
import type { Result } from "../result";
import type { FrpcInstaller } from "./frpc-installer";
import type { TunnelApi } from "./tunnel-api";
import type { TunnelConfig } from "./tunnel-config";

export type TunnelPhase =
  | "signed_out"
  | "stopped"
  | "starting"
  | "connecting"
  | "online"
  | "reconnecting"
  | "error";

export interface TunnelStatus {
  phase: TunnelPhase;
  enabled: boolean;
  /** Tunnel API URL is set (KCG_TUNNEL_API_URL, or baked into the npm package). */
  configured: boolean;
  account: { email: string; username: string; url: string } | null;
  /** Device flow berjalan: tampilkan kode + tautan ke pengguna. */
  pairing: {
    userCode: string;
    verificationUri: string;
    verificationUriComplete: string;
    expiresAt: number;
  } | null;
  /** Kode error terakhir (lihat `apiErrorMessage`). */
  error: string | null;
  /** Nomor urut baris log terakhir (klien minta `?from=`). */
  logOffset: number;
}

/** Proses frpc minimal (di-mock pada test). */
export interface FrpcProcessLike {
  pid?: number;
  exited: Promise<number | null>;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  kill(signal?: "SIGTERM" | "SIGKILL"): void;
}

export interface TunnelManagerOptions {
  store: SessionStore;
  config: TunnelConfig;
  api: TunnelApi;
  installer: FrpcInstaller;
  /** Port & host kcgcode yang diekspos. */
  localPort: number;
  localHost: string;
  configPath: string;
  isProtected: () => boolean;
  /** Nama perangkat di halaman persetujuan (default: hostname OS). */
  deviceName?: string;
  spawn?: (bin: string, configPath: string) => FrpcProcessLike;
  now?: () => number;
  /** Backoff restart frpc (ms); di-override test. */
  backoff?: (attempt: number) => number;
  /** Tidur antar-poll device flow (ms); di-override test. */
  sleep?: (ms: number) => Promise<void>;
}

export interface TunnelManager {
  status(): TunnelStatus;
  logs(from: number): { lines: string[]; next: number };
  /** Mulai device flow (membatalkan yang sedang berjalan). */
  connect(): Promise<Result<TunnelStatus>>;
  cancelConnect(): void;
  start(): Promise<Result<TunnelStatus>>;
  stop(): Promise<TunnelStatus>;
  signOut(): Promise<TunnelStatus>;
  rotateSecret(): Promise<Result<TunnelStatus>>;
  /** Kunci aplikasi berubah; tanpa kunci tunnel dimatikan. */
  handleLockChanged(protectedNow: boolean): void;
  /** Dipanggil saat server siap: nyalakan ulang bila sebelumnya aktif. */
  autoStart(): void;
  shutdown(): Promise<void>;
}

const MAX_LOG_LINES = 300;
const SERVER_ADDR_RE = /^[A-Za-z0-9.-]{1,253}$/;

// biome-ignore lint/suspicious/noControlCharactersInRegex: buang kode warna ANSI
const ANSI_RE = /\u001b\[[0-9;]*m/g;

function tomlString(v: string): string {
  return JSON.stringify(v); // subset aman: kita sudah memvalidasi karakter
}

/** Ambil `serverAddr` & `serverPort` dari frpc.toml buatan VPS. */
export function parseFrpServer(toml: string): { addr: string; port: number } | null {
  const addr = toml.match(/^\s*serverAddr\s*=\s*"([^"]+)"/m)?.[1];
  const portRaw = toml.match(/^\s*serverPort\s*=\s*(\d+)/m)?.[1];
  const port = portRaw ? Number(portRaw) : 7000;
  if (!addr || !SERVER_ADDR_RE.test(addr)) return null;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { addr, port };
}

/** Host lokal yang dituju frpc: bind wildcard -> loopback. */
export function frpcLocalIp(host: string): string {
  if (host === "0.0.0.0" || host === "::" || host === "localhost" || host === "") {
    return "127.0.0.1";
  }
  return /^[0-9A-Fa-f:.]+$/.test(host) ? host : "127.0.0.1";
}

export function buildFrpcConfig(p: {
  serverAddr: string;
  serverPort: number;
  username: string;
  tunnelSecret: string;
  localIp: string;
  localPort: number;
}): string {
  return `# Generated by kcgcode — do not edit (rewritten on every start)
serverAddr = ${tomlString(p.serverAddr)}
serverPort = ${p.serverPort}
loginFailExit = true
log.to = "console"
log.level = "info"
log.disablePrintColor = true

# fp-multiuser: per-user token
user = ${tomlString(p.username)}
metadatas.token = ${tomlString(p.tunnelSecret)}

[[proxies]]
name = ${tomlString(p.username)}
type = "http"
localIP = ${tomlString(p.localIp)}
localPort = ${p.localPort}
subdomain = ${tomlString(p.username)}
`;
}

/** Klasifikasi baris log frpc -> transisi status. */
export function classifyFrpcLine(
  line: string,
): "online" | "logged_in" | "reconnecting" | "auth_failed" | "proxy_failed" | null {
  if (/start proxy success/i.test(line)) return "online";
  if (/login to server success/i.test(line)) return "logged_in";
  if (/(start error|proxy .*error|subdomain .*(used|exist))/i.test(line)) return "proxy_failed";
  if (/(reject|authorization|invalid.*token|token.*invalid)/i.test(line)) return "auth_failed";
  if (
    /(try to reconnect|reconnect|connect to server error|login to the server failed)/i.test(line)
  ) {
    return "reconnecting";
  }
  return null;
}

const DEFAULT_SPAWN = (bin: string, configPath: string): FrpcProcessLike => {
  const proc = Bun.spawn([bin, "-c", configPath], {
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

export function createTunnelManager(opts: TunnelManagerOptions): TunnelManager {
  const { store, config, api, installer } = opts;
  const now = opts.now ?? Date.now;
  const spawn = opts.spawn ?? DEFAULT_SPAWN;
  const backoff = opts.backoff ?? ((n: number) => Math.min(60_000, 2000 * 2 ** n));
  const sleep = opts.sleep ?? ((ms: number) => Bun.sleep(ms));
  const deviceName = (opts.deviceName ?? `kcgcode on ${osHostname()}`).slice(0, 60);

  let phase: Exclude<TunnelPhase, "signed_out"> = "stopped";
  let lastError: string | null = null;
  let pairing: (TunnelStatus["pairing"] & { deviceCode: string; id: number }) | null = null;
  let pairingSeq = 0;

  let proc: FrpcProcessLike | null = null;
  let stopping = false;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  /** Serialisasi start/stop agar tidak ada dua frpc. */
  let chain: Promise<unknown> = Promise.resolve();

  // Buffer log bergulir dengan kursor absolut: `total` = jumlah baris yang
  // pernah ditulis; baris pertama di `lines` berindeks `total - lines.length`.
  const lines: string[] = [];
  let total = 0;

  function settings() {
    return store.getTunnelSettings(now());
  }

  function log(line: string): void {
    // Jangan pernah mencatat secret/token (frpc tidak mencetaknya, tapi jaga-jaga).
    const a = settings().account;
    let clean = line.replace(ANSI_RE, "").trimEnd();
    for (const s of [a?.tunnelSecret, a?.deviceToken]) if (s) clean = clean.split(s).join("***");
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

  function status(): TunnelStatus {
    const s = settings();
    const a = s.account;
    if (pairing && pairing.expiresAt <= now()) pairing = null;
    return {
      phase: a ? phase : "signed_out",
      enabled: s.enabled,
      configured: config.apiUrl !== null,
      account: a ? { email: a.email, username: a.username, url: `https://${a.subdomain}` } : null,
      pairing: pairing
        ? {
            userCode: pairing.userCode,
            verificationUri: pairing.verificationUri,
            verificationUriComplete: pairing.verificationUriComplete,
            expiresAt: pairing.expiresAt,
          }
        : null,
      error: lastError,
      logOffset: total,
    };
  }

  // -------------------------------------------------------- device flow ----

  async function connect(): Promise<Result<TunnelStatus>> {
    if (config.apiUrl === null) return { ok: false, error: "TUNNEL_NOT_CONFIGURED" };
    const res = await api.startDevice(deviceName, opts.localPort);
    if (!res.ok) {
      lastError = res.error;
      return res;
    }
    const id = ++pairingSeq;
    pairing = {
      id,
      deviceCode: res.data.deviceCode,
      userCode: res.data.userCode,
      verificationUri: res.data.verificationUri,
      verificationUriComplete: res.data.verificationUriComplete,
      expiresAt: now() + res.data.expiresIn * 1000,
    };
    lastError = null;
    log(`Waiting for approval — code ${res.data.userCode}`);
    void pollLoop(id, res.data.interval);
    return { ok: true, data: status() };
  }

  /** Poll sampai disetujui / ditolak / kedaluwarsa / dibatalkan. */
  async function pollLoop(id: number, initialInterval: number): Promise<void> {
    let interval = initialInterval;
    let failures = 0;
    while (pairing?.id === id) {
      await sleep(interval * 1000);
      if (pairing?.id !== id) return;
      if (pairing.expiresAt <= now()) {
        pairing = null;
        lastError = "TUNNEL_PAIRING_EXPIRED";
        return;
      }
      const r = await api.pollDevice(pairing.deviceCode);
      if (pairing?.id !== id) return;
      if (!r.ok) {
        // Gangguan jaringan sementara: coba lagi, menyerah setelah beberapa kali.
        if (++failures >= 5) {
          pairing = null;
          lastError = r.error;
          return;
        }
        continue;
      }
      failures = 0;
      switch (r.data.state) {
        case "pending":
          break;
        case "slow_down":
          interval += 5; // RFC 8628 §3.5
          break;
        case "denied":
          pairing = null;
          lastError = "TUNNEL_PAIRING_DENIED";
          return;
        case "expired":
          pairing = null;
          lastError = "TUNNEL_PAIRING_EXPIRED";
          return;
        case "granted": {
          const g = r.data.grant;
          pairing = null;
          store.setTunnelAccount(
            {
              email: g.email,
              username: g.username,
              subdomain: g.subdomain,
              deviceId: g.deviceId,
              deviceToken: g.deviceToken,
              tunnelSecret: g.tunnelSecret,
            },
            now(),
          );
          phase = "stopped";
          lastError = null;
          log(`Connected as ${g.email} → https://${g.subdomain}`);
          // Nyalakan langsung bila kunci sudah ada (pengguna baru saja meminta).
          if (opts.isProtected()) void start();
          return;
        }
      }
    }
  }

  function cancelConnect(): void {
    pairing = null;
  }

  /** Device dicabut di VPS: lupakan akun lokal. */
  function forgetRevoked(): void {
    store.setTunnelAccount(null, now());
    store.setTunnelEnabled(false, now());
    rmSync(opts.configPath, { force: true });
    lastError = "TUNNEL_DEVICE_REVOKED";
    log("This device was disconnected from your account.");
  }

  // ------------------------------------------------------------- frpc ----

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

  /** Siapkan config lokal: segarkan dari VPS bila bisa, pakai cache bila tidak. */
  async function prepareConfig(account: TunnelAccount): Promise<Result<string>> {
    let server: { addr: string; port: number } | null = null;
    const fresh = await api.fetchConfig(account.deviceToken, opts.localPort);
    if (fresh.ok) {
      server = parseFrpServer(fresh.data);
      if (!server) return { ok: false, error: "TUNNEL_API_UNREACHABLE" };
    } else if (fresh.error === "TUNNEL_DEVICE_REVOKED") {
      return fresh;
    } else if (existsSync(opts.configPath)) {
      // VPS tak terjangkau: secret lokal masih berlaku.
      server = parseFrpServer(readFileSync(opts.configPath, "utf8"));
      if (server) log(`Using cached tunnel config (${fresh.error}).`);
    }
    if (!server) return { ok: false, error: fresh.ok ? "TUNNEL_API_UNREACHABLE" : fresh.error };

    const toml = buildFrpcConfig({
      serverAddr: server.addr,
      serverPort: server.port,
      username: account.username,
      tunnelSecret: account.tunnelSecret,
      localIp: frpcLocalIp(opts.localHost),
      localPort: opts.localPort,
    });
    mkdirSync(path.dirname(opts.configPath), { recursive: true });
    writeFileSync(opts.configPath, toml, { encoding: "utf8", mode: 0o600 });
    chmodSync(opts.configPath, 0o600);
    return { ok: true, data: opts.configPath };
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
          for (const p of parts) onLine(p);
        }
      } catch {
        /* stream ditutup */
      }
      if (buf) onLine(buf);
    })();
  }

  async function launch(): Promise<Result<null>> {
    const account = settings().account;
    if (!account) return { ok: false, error: "TUNNEL_SIGNED_OUT" };
    if (!opts.isProtected()) return { ok: false, error: "TUNNEL_LOCK_REQUIRED" };

    phase = "starting";
    const bin = await installer.ensure(log);
    if (!bin.ok) return bin;
    const cfg = await prepareConfig(account);
    if (!cfg.ok) return cfg;

    let p: FrpcProcessLike;
    try {
      p = spawn(bin.data, cfg.data);
    } catch (e) {
      log(`Failed to start frpc: ${(e as Error).message}`);
      return { ok: false, error: "FRPC_START_FAILED" };
    }
    proc = p;
    phase = "connecting";
    log(`frpc started (pid ${p.pid ?? "?"}) → https://${account.subdomain}`);

    let fatal: string | null = null;
    const onLine = (l: string) => {
      log(l);
      if (proc !== p) return;
      switch (classifyFrpcLine(l)) {
        case "online":
          phase = "online";
          attempt = 0;
          lastError = null;
          break;
        case "logged_in":
          if (phase !== "online") phase = "connecting";
          break;
        case "reconnecting":
          phase = "reconnecting";
          break;
        case "auth_failed":
          fatal = "TUNNEL_AUTH_FAILED";
          break;
        case "proxy_failed":
          fatal = "TUNNEL_PROXY_FAILED";
          break;
      }
    };
    drain(p.stdout, onLine);
    drain(p.stderr, onLine);

    void p.exited.then((code) => {
      if (proc !== p || stopping) return; // dihentikan sengaja / diganti
      proc = null;
      log(`frpc exited (code ${code ?? "?"}).`);
      if (fatal) {
        // Ditolak server: restart tidak akan menolong.
        phase = "error";
        lastError = fatal;
        return;
      }
      if (!settings().enabled || !opts.isProtected()) {
        phase = "stopped";
        return;
      }
      phase = "reconnecting";
      const delay = backoff(attempt++);
      log(`Restarting frpc in ${Math.round(delay / 1000)}s…`);
      clearRestart();
      restartTimer = setTimeout(() => {
        restartTimer = null;
        void serialize(async () => {
          if (proc || !settings().enabled) return;
          const r = await launch();
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

  function start(): Promise<Result<TunnelStatus>> {
    return serialize(async () => {
      if (!settings().account) return { ok: false, error: "TUNNEL_SIGNED_OUT" };
      if (!opts.isProtected()) return { ok: false, error: "TUNNEL_LOCK_REQUIRED" };
      clearRestart();
      await killProc();
      attempt = 0;
      lastError = null;
      store.setTunnelEnabled(true, now());
      const r = await launch();
      if (!r.ok) {
        if (r.error === "TUNNEL_DEVICE_REVOKED") {
          forgetRevoked();
          return r;
        }
        phase = "error";
        lastError = r.error;
        return r;
      }
      return { ok: true, data: status() };
    });
  }

  function stop(): Promise<TunnelStatus> {
    return serialize(async () => {
      store.setTunnelEnabled(false, now());
      clearRestart();
      await killProc();
      phase = "stopped";
      log("Tunnel stopped.");
      return status();
    });
  }

  async function signOut(): Promise<TunnelStatus> {
    cancelConnect();
    const token = settings().account?.deviceToken;
    await stop();
    // Cabut device token di VPS juga (best effort; offline tetap dihapus lokal).
    if (token) {
      const r = await api.revokeSelf(token);
      if (!r.ok) log(`Couldn't revoke this device on the server (${r.error}).`);
    }
    store.setTunnelAccount(null, now());
    rmSync(opts.configPath, { force: true });
    lastError = null;
    log("Signed out.");
    return status();
  }

  async function rotateSecret(): Promise<Result<TunnelStatus>> {
    const account = settings().account;
    if (!account) return { ok: false, error: "TUNNEL_SIGNED_OUT" };
    const res = await api.rotateSecret(account.deviceToken);
    if (!res.ok) {
      if (res.error === "TUNNEL_DEVICE_REVOKED") {
        await stop();
        forgetRevoked();
      }
      return res;
    }
    store.setTunnelSecret(res.data, now());
    log("Tunnel secret rotated.");
    // Secret lama langsung ditolak VPS: jalankan ulang bila sedang aktif.
    if (settings().enabled) return start();
    return { ok: true, data: status() };
  }

  function handleLockChanged(protectedNow: boolean): void {
    if (protectedNow) return;
    if (!settings().enabled && !proc) return;
    log("App lock removed — tunnel turned off.");
    void stop().then(() => {
      lastError = "TUNNEL_LOCK_REQUIRED";
    });
  }

  function autoStart(): void {
    const s = settings();
    if (!s.enabled || !s.account) return;
    if (!opts.isProtected()) {
      store.setTunnelEnabled(false, now());
      return;
    }
    void start().then((r) => {
      if (!r.ok) console.error(`[kcg-code] tunnel gagal dinyalakan: ${r.error}`);
    });
  }

  async function shutdown(): Promise<void> {
    cancelConnect();
    clearRestart();
    // `enabled` dibiarkan -> tunnel menyala lagi di start berikutnya.
    await serialize(() => killProc());
  }

  return {
    status,
    logs(from) {
      const first = total - lines.length;
      const startAt = Math.min(Math.max(from, first), total);
      return { lines: lines.slice(startAt - first), next: total };
    },
    connect,
    cancelConnect,
    start,
    stop,
    signOut,
    rotateSecret,
    handleLockChanged,
    autoStart,
    shutdown,
  };
}
