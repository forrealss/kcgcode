/**
 * Koneksi tunggal ke service opencode: sambung malas (dengan cek versi CLI),
 * pompa langganan event, dan reconnect dengan backoff saat stream putus.
 * Panggilan API dibungkus `call` / `reply` agar error menjadi `Result`.
 */
import type { Result, SimpleResult } from "../../result";
import { AGENT_REQUEST_GONE } from "../types";
import type { OpencodeApi, OpencodeConnector } from "./api";
import { errorMessage, errorName, rec } from "./util";
import { checkOpencodeVersion, type VersionProbe } from "./version";

type Connected = Result<{ api: OpencodeApi; pid: unknown }>;

const GONE_ERRORS = new Set([
  "SessionNotFoundError",
  "PermissionNotFoundError",
  "FormNotFoundError",
  "FormAlreadySettledError",
]);

export interface OpencodeConnectionDeps {
  connector: OpencodeConnector;
  versionProbe?: VersionProbe;
  /** Jeda awal reconnect (ms); berlipat sampai `maxDelay`. */
  baseDelay: number;
  maxDelay: number;
  /** Tiap event mentah dari langganan. */
  onEvent(raw: unknown): void;
  /** Turn yang berjalan hilang (service berganti / tidak terjangkau). */
  onLost(): void;
}

export class OpencodeConnection {
  /** Koneksi aktif (dibuat malas); null = belum/terputus. */
  private conn: Promise<Connected> | null = null;
  private stopped = false;
  private abort: AbortController | null = null;
  private reconnecting = false;

  constructor(private readonly deps: OpencodeConnectionDeps) {}

  connect(): Promise<Connected> {
    if (!this.conn) {
      const attempt = (async (): Promise<Connected> => {
        const version = await checkOpencodeVersion(this.deps.versionProbe);
        if (!version.ok) return version;
        try {
          const api = await this.deps.connector();
          const info = rec(await api.server.info());
          void this.pump(api, info.pid);
          return { ok: true, data: { api, pid: info.pid } };
        } catch (e) {
          return { ok: false, error: `SERVER_START_FAILED: ${errorMessage(e)}` };
        }
      })();
      this.conn = attempt;
      // Gagal -> izinkan percobaan berikutnya (mis. user baru meng-upgrade).
      void attempt.then((r) => {
        if (!r.ok && this.conn === attempt) this.conn = null;
      });
    }
    return this.conn;
  }

  async api(): Promise<OpencodeApi> {
    const res = await this.connect();
    if (!res.ok) throw new Error(res.error);
    return res.data.api;
  }

  /** Jalankan panggilan API; error -> `Result` gagal dengan prefiks `code`. */
  async call<T>(code: string, fn: (a: OpencodeApi) => Promise<T>): Promise<Result<T>> {
    try {
      return { ok: true, data: await fn(await this.api()) };
    } catch (e) {
      return { ok: false, error: `${code}: ${errorMessage(e)}` };
    }
  }

  /** Seperti `call` untuk reply: request yang sudah tidak ditunggu -> GONE. */
  async reply(code: string, fn: (a: OpencodeApi) => Promise<unknown>): Promise<SimpleResult> {
    try {
      await fn(await this.api());
      return { ok: true };
    } catch (e) {
      if (GONE_ERRORS.has(errorName(e))) return { ok: false, error: AGENT_REQUEST_GONE };
      return { ok: false, error: `${code}: ${errorMessage(e)}` };
    }
  }

  /** Lepas langganan event; tidak ada reconnect lagi. */
  stop(): void {
    this.stopped = true;
    this.abort?.abort();
  }

  private async pump(api: OpencodeApi, pid: unknown): Promise<void> {
    const ctrl = new AbortController();
    this.abort = ctrl;
    try {
      for await (const raw of api.event.subscribe(undefined, { signal: ctrl.signal })) {
        this.deps.onEvent(raw);
      }
    } catch {
      // Stream putus — ditangani di bawah.
    }
    if (this.stopped || ctrl.signal.aborted) return;
    void this.reconnect(pid);
  }

  /** Sambung ulang setelah stream putus; backoff sampai berhasil. */
  private async reconnect(prevPid: unknown): Promise<void> {
    if (this.reconnecting) return;
    this.reconnecting = true;
    this.conn = null;
    let delay = this.deps.baseDelay;
    let lostNotified = false;
    try {
      while (!this.stopped) {
        await Bun.sleep(delay);
        if (this.stopped) return;
        const res = await this.connect();
        if (res.ok) {
          // Service berganti: turn yang berjalan di service lama hilang.
          if (!lostNotified && res.data.pid !== prevPid) this.deps.onLost();
          return;
        }
        if (!lostNotified) {
          lostNotified = true;
          this.deps.onLost();
        }
        delay = Math.min(delay * 2, this.deps.maxDelay);
      }
    } finally {
      this.reconnecting = false;
    }
  }
}
