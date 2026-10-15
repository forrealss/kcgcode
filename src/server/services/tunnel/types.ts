/**
 * Kontrak publik Tunnel_Manager: fase & status (dikirim ke browser), opsi,
 * antarmuka `TunnelManager`, plus state bersama yang dipakai modul internal.
 */

import type { SessionStore } from "../../../db";
import type { Result } from "../../result";
import type { FrpcInstaller } from "../frpc-installer";
import type { TunnelApi } from "../tunnel-api";
import type { TunnelConfig } from "../tunnel-config";

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

/** Device flow yang sedang berjalan (termasuk `deviceCode` rahasia). */
export type Pairing = NonNullable<TunnelStatus["pairing"]> & { deviceCode: string; id: number };

/**
 * State mutable bersama milik satu manager. Dibaca `status()` dan diubah oleh
 * device flow, supervisor frpc, serta aksi publik manager.
 */
export interface TunnelState {
  phase: Exclude<TunnelPhase, "signed_out">;
  lastError: string | null;
  pairing: Pairing | null;
}

/** Jalankan aksi secara berurutan (lihat `serialize` di manager). */
export type Serialize = <T>(fn: () => Promise<T>) => Promise<T>;

/** Penulis baris log tunnel. */
export type TunnelLogFn = (line: string) => void;
