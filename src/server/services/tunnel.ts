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
 *
 * Bagian yang berdiri sendiri ada di `./tunnel/`: kontrak publik (`types`),
 * helper murni frpc (`frpc-config`), buffer log (`log-buffer`), device flow
 * (`device-flow`), penyiapan file config (`prepare-config`), dan pengawas
 * proses frpc (`frpc-supervisor`).
 */

import { rmSync } from "node:fs";
import { hostname as osHostname } from "node:os";
import type { Result } from "../result";
import { DeviceFlow } from "./tunnel/device-flow";
import { DEFAULT_SPAWN, FrpcSupervisor } from "./tunnel/frpc-supervisor";
import { TunnelLogBuffer } from "./tunnel/log-buffer";
import { prepareFrpcConfig } from "./tunnel/prepare-config";
import type {
  TunnelManager,
  TunnelManagerOptions,
  TunnelState,
  TunnelStatus,
} from "./tunnel/types";

export {
  buildFrpcConfig,
  classifyFrpcLine,
  frpcLocalIp,
  parseFrpServer,
} from "./tunnel/frpc-config";
export type {
  FrpcProcessLike,
  TunnelManager,
  TunnelManagerOptions,
  TunnelPhase,
  TunnelStatus,
} from "./tunnel/types";

export function createTunnelManager(opts: TunnelManagerOptions): TunnelManager {
  const { store, config, api, installer } = opts;
  const now = opts.now ?? Date.now;
  const spawn = opts.spawn ?? DEFAULT_SPAWN;
  const backoff = opts.backoff ?? ((n: number) => Math.min(60_000, 2000 * 2 ** n));
  const sleep = opts.sleep ?? ((ms: number) => Bun.sleep(ms));
  const deviceName = (opts.deviceName ?? `kcgcode on ${osHostname()}`).slice(0, 60);

  const state: TunnelState = { phase: "stopped", lastError: null, pairing: null };
  /** Serialisasi start/stop agar tidak ada dua frpc. */
  let chain: Promise<unknown> = Promise.resolve();

  function settings() {
    return store.getTunnelSettings(now());
  }

  const logBuffer = new TunnelLogBuffer(() => {
    const a = settings().account;
    return [a?.tunnelSecret, a?.deviceToken];
  });
  const log = logBuffer.write;

  function serialize<T>(fn: () => Promise<T>): Promise<T> {
    const p = chain.then(fn, fn);
    chain = p.catch(() => {});
    return p;
  }

  function status(): TunnelStatus {
    const s = settings();
    const a = s.account;
    if (state.pairing && state.pairing.expiresAt <= now()) state.pairing = null;
    return {
      phase: a ? state.phase : "signed_out",
      enabled: s.enabled,
      configured: config.apiUrl !== null,
      account: a ? { email: a.email, username: a.username, url: `https://${a.subdomain}` } : null,
      pairing: state.pairing
        ? {
            userCode: state.pairing.userCode,
            verificationUri: state.pairing.verificationUri,
            verificationUriComplete: state.pairing.verificationUriComplete,
            expiresAt: state.pairing.expiresAt,
          }
        : null,
      error: state.lastError,
      logOffset: logBuffer.total,
    };
  }

  const deviceFlow = new DeviceFlow({
    store,
    config,
    api,
    state,
    deviceName,
    localPort: opts.localPort,
    now,
    sleep,
    log,
    status,
    // Nyalakan langsung bila kunci sudah ada (pengguna baru saja meminta).
    onGranted: () => {
      if (opts.isProtected()) void start();
    },
  });

  const supervisor = new FrpcSupervisor({
    state,
    settings,
    isProtected: opts.isProtected,
    installer,
    spawn,
    backoff,
    prepareConfig: (account) =>
      prepareFrpcConfig(
        {
          api,
          configPath: opts.configPath,
          localHost: opts.localHost,
          localPort: opts.localPort,
          previewPort: opts.previewPort?.() ?? null,
          log,
        },
        account,
      ),
    log,
    serialize,
  });

  function cancelConnect(): void {
    deviceFlow.cancel();
  }

  /** Device dicabut di VPS: lupakan akun lokal. */
  function forgetRevoked(): void {
    store.setTunnelAccount(null, now());
    store.setTunnelEnabled(false, now());
    rmSync(opts.configPath, { force: true });
    state.lastError = "TUNNEL_DEVICE_REVOKED";
    log("This device was disconnected from your account.");
  }

  function start(): Promise<Result<TunnelStatus>> {
    return serialize(async () => {
      if (!settings().account) return { ok: false, error: "TUNNEL_SIGNED_OUT" };
      if (!opts.isProtected()) return { ok: false, error: "TUNNEL_LOCK_REQUIRED" };
      supervisor.clearRestart();
      await supervisor.kill();
      supervisor.resetAttempts();
      state.lastError = null;
      store.setTunnelEnabled(true, now());
      const r = await supervisor.launch();
      if (!r.ok) {
        if (r.error === "TUNNEL_DEVICE_REVOKED") {
          forgetRevoked();
          return r;
        }
        state.phase = "error";
        state.lastError = r.error;
        return r;
      }
      return { ok: true, data: status() };
    });
  }

  function stop(): Promise<TunnelStatus> {
    return serialize(async () => {
      store.setTunnelEnabled(false, now());
      supervisor.clearRestart();
      await supervisor.kill();
      state.phase = "stopped";
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
    state.lastError = null;
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
    if (!settings().enabled && !supervisor.running) return;
    log("App lock removed — tunnel turned off.");
    void stop().then(() => {
      state.lastError = "TUNNEL_LOCK_REQUIRED";
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
    supervisor.clearRestart();
    // `enabled` dibiarkan -> tunnel menyala lagi di start berikutnya.
    await serialize(() => supervisor.kill());
  }

  return {
    status,
    logs: (from) => logBuffer.read(from),
    connect: () => deviceFlow.connect(),
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
