/**
 * Device authorization flow (RFC 8628) ke kcgcode-rp: minta `user_code`, lalu
 * poll `/device/token` sampai disetujui / ditolak / kedaluwarsa / dibatalkan.
 * Grant disimpan ke store; kredensial Google tidak pernah sampai ke kcgcode.
 */

import type { SessionStore } from "../../../db";
import type { Result } from "../../result";
import type { TunnelApi } from "../tunnel-api";
import type { TunnelConfig } from "../tunnel-config";
import type { TunnelLogFn, TunnelState, TunnelStatus } from "./types";

export interface DeviceFlowDeps {
  store: SessionStore;
  config: TunnelConfig;
  api: TunnelApi;
  state: TunnelState;
  deviceName: string;
  localPort: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  log: TunnelLogFn;
  status: () => TunnelStatus;
  /** Akun baru tersimpan (device disetujui). */
  onGranted: () => void;
}

export class DeviceFlow {
  private pairingSeq = 0;

  constructor(private readonly deps: DeviceFlowDeps) {}

  async connect(): Promise<Result<TunnelStatus>> {
    const { config, api, state, now, log } = this.deps;
    if (config.apiUrl === null) return { ok: false, error: "TUNNEL_NOT_CONFIGURED" };
    const res = await api.startDevice(this.deps.deviceName, this.deps.localPort);
    if (!res.ok) {
      state.lastError = res.error;
      return res;
    }
    const id = ++this.pairingSeq;
    state.pairing = {
      id,
      deviceCode: res.data.deviceCode,
      userCode: res.data.userCode,
      verificationUri: res.data.verificationUri,
      verificationUriComplete: res.data.verificationUriComplete,
      expiresAt: now() + res.data.expiresIn * 1000,
    };
    state.lastError = null;
    log(`Waiting for approval — code ${res.data.userCode}`);
    void this.pollLoop(id, res.data.interval);
    return { ok: true, data: this.deps.status() };
  }

  cancel(): void {
    this.deps.state.pairing = null;
  }

  /** Poll sampai disetujui / ditolak / kedaluwarsa / dibatalkan. */
  private async pollLoop(id: number, initialInterval: number): Promise<void> {
    const { store, api, state, now, sleep, log } = this.deps;
    let interval = initialInterval;
    let failures = 0;
    while (state.pairing?.id === id) {
      await sleep(interval * 1000);
      if (state.pairing?.id !== id) return;
      if (state.pairing.expiresAt <= now()) {
        state.pairing = null;
        state.lastError = "TUNNEL_PAIRING_EXPIRED";
        return;
      }
      const r = await api.pollDevice(state.pairing.deviceCode);
      if (state.pairing?.id !== id) return;
      if (!r.ok) {
        // Gangguan jaringan sementara: coba lagi, menyerah setelah beberapa kali.
        if (++failures >= 5) {
          state.pairing = null;
          state.lastError = r.error;
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
          state.pairing = null;
          state.lastError = "TUNNEL_PAIRING_DENIED";
          return;
        case "expired":
          state.pairing = null;
          state.lastError = "TUNNEL_PAIRING_EXPIRED";
          return;
        case "granted": {
          const g = r.data.grant;
          state.pairing = null;
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
          state.phase = "stopped";
          state.lastError = null;
          log(`Connected as ${g.email} → https://${g.subdomain}`);
          this.deps.onGranted();
          return;
        }
      }
    }
  }
}
