/**
 * Pengawas proses frpc: spawn, baca log stdout/stderr untuk transisi fase,
 * restart dengan backoff saat keluar tak terduga, dan berhenti permanen bila
 * ditolak server (auth/proxy gagal).
 */

import type { TunnelAccount, TunnelSettings } from "../../db/tunnel";
import type { Result } from "../../result";
import type { FrpcInstaller } from "../frpc-installer";
import { classifyFrpcLine } from "./frpc-config";
import type { FrpcProcessLike, Serialize, TunnelLogFn, TunnelState } from "./types";

export const DEFAULT_SPAWN = (bin: string, configPath: string): FrpcProcessLike => {
  const proc = Bun.spawn([bin, "-c", configPath], {
    windowsHide: true,
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

export interface FrpcSupervisorDeps {
  state: TunnelState;
  settings: () => TunnelSettings;
  isProtected: () => boolean;
  installer: FrpcInstaller;
  spawn: (bin: string, configPath: string) => FrpcProcessLike;
  backoff: (attempt: number) => number;
  prepareConfig: (account: TunnelAccount) => Promise<Result<string>>;
  log: TunnelLogFn;
  /** Restart terjadwal ikut antrean start/stop manager. */
  serialize: Serialize;
}

export class FrpcSupervisor {
  private proc: FrpcProcessLike | null = null;
  private stopping = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;

  constructor(private readonly deps: FrpcSupervisorDeps) {}

  /** Ada proses frpc yang sedang diawasi. */
  get running(): boolean {
    return this.proc !== null;
  }

  resetAttempts(): void {
    this.attempt = 0;
  }

  clearRestart(): void {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }

  async kill(): Promise<void> {
    const p = this.proc;
    this.proc = null;
    if (!p) return;
    this.stopping = true;
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
      this.stopping = false;
    }
  }

  async launch(): Promise<Result<null>> {
    const { state, settings, isProtected, installer, spawn, log } = this.deps;
    const account = settings().account;
    if (!account) return { ok: false, error: "TUNNEL_SIGNED_OUT" };
    if (!isProtected()) return { ok: false, error: "TUNNEL_LOCK_REQUIRED" };

    state.phase = "starting";
    const bin = await installer.ensure(log);
    if (!bin.ok) return bin;
    const cfg = await this.deps.prepareConfig(account);
    if (!cfg.ok) return cfg;

    let p: FrpcProcessLike;
    try {
      p = spawn(bin.data, cfg.data);
    } catch (e) {
      log(`Failed to start frpc: ${(e as Error).message}`);
      return { ok: false, error: "FRPC_START_FAILED" };
    }
    this.proc = p;
    state.phase = "connecting";
    log(`frpc started (pid ${p.pid ?? "?"}) → https://${account.subdomain}`);

    let fatal: string | null = null;
    const onLine = (l: string) => {
      log(l);
      if (this.proc !== p) return;
      switch (classifyFrpcLine(l)) {
        case "online":
          state.phase = "online";
          this.attempt = 0;
          state.lastError = null;
          break;
        case "logged_in":
          if (state.phase !== "online") state.phase = "connecting";
          break;
        case "reconnecting":
          state.phase = "reconnecting";
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
      if (this.proc !== p || this.stopping) return; // dihentikan sengaja / diganti
      this.proc = null;
      log(`frpc exited (code ${code ?? "?"}).`);
      if (fatal) {
        // Ditolak server: restart tidak akan menolong.
        state.phase = "error";
        state.lastError = fatal;
        return;
      }
      if (!settings().enabled || !isProtected()) {
        state.phase = "stopped";
        return;
      }
      state.phase = "reconnecting";
      this.scheduleRestart();
    });
    return { ok: true, data: null };
  }

  private scheduleRestart(): void {
    const { state, settings, log } = this.deps;
    const delay = this.deps.backoff(this.attempt++);
    log(`Restarting frpc in ${Math.round(delay / 1000)}s…`);
    this.clearRestart();
    const timer = setTimeout(() => {
      this.restartTimer = null;
      void this.deps.serialize(async () => {
        if (this.proc || !settings().enabled) return;
        const r = await this.launch();
        if (!r.ok) {
          state.phase = "error";
          state.lastError = r.error;
        }
      });
    }, delay);
    this.restartTimer = timer;
    timer.unref?.();
  }
}
