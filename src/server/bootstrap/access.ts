/**
 * Akses ke server: kunci aplikasi (lock screen + passkey) dan dua penyedia
 * remote access (tunnel KCG via frpc & localhost.run via ssh). Kedua tunnel
 * mewajibkan app lock, sehingga dirakit bersama `AuthService` dan ikut
 * bereaksi saat kunci diatur/dihapus.
 *
 * Juga berisi siklus hidup tunnel milik composition root: penyalaan ulang
 * setelah server listen (`autoStartSelectedTunnel`).
 */

import path from "node:path";
import type { SessionStore } from "../../db";
import { resolveFrpcConfigPath } from "../../paths";
import { type AuthService, createAuthService } from "../services/auth";
import { createPasskeyService, type PasskeyService } from "../services/auth-passkeys";
import { createFrpcInstaller } from "../services/frpc-installer";
import { createTunnelManager, type TunnelManager } from "../services/tunnel";
import { createTunnelApi } from "../services/tunnel-api";
import { resolveTunnelConfig } from "../services/tunnel-config";
import { createLhrManager, type LhrManager } from "../services/tunnel-lhr";
import type { KcgServerOptions } from "./types";

export interface AccessOptions extends Pick<KcgServerOptions, "auth" | "tunnel" | "lhr"> {
  store: SessionStore;
  port: number;
  hostname: string;
}

export interface Access {
  auth: AuthService;
  passkeys: PasskeyService;
  tunnel: TunnelManager;
  lhr: LhrManager;
}

export function createAccess(opts: AccessOptions): Access {
  const { store, port, hostname } = opts;

  // ---- Kunci aplikasi (lock screen) ----
  const auth = opts.auth ?? createAuthService({ store });
  const passkeys = createPasskeyService({ store, auth });

  // ---- Tunnel publik (<username>.<domain dari VPS>) — wajib app lock ----
  const tunnel = opts.tunnel
    ? opts.tunnel({ store, auth, port, hostname })
    : (() => {
        const tcfg = resolveTunnelConfig();
        return createTunnelManager({
          store,
          config: tcfg,
          // Tanpa URL API: klien yang selalu gagal (connect() sudah menolak lebih dulu).
          api: createTunnelApi(tcfg.apiUrl ?? "http://tunnel-api.invalid"),
          installer: createFrpcInstaller(),
          localPort: port,
          localHost: hostname,
          configPath: resolveFrpcConfigPath(),
          isProtected: () => auth.isProtected(),
        });
      })();
  // ---- Tunnel localhost.run (gratis, via ssh) — wajib app lock ----
  const lhr = opts.lhr
    ? opts.lhr({ store, auth, port, hostname })
    : createLhrManager({
        store,
        localPort: port,
        localHost: hostname,
        dataDir: path.dirname(resolveFrpcConfigPath()),
        isProtected: () => auth.isProtected(),
      });
  auth.onLockChanged((prot) => {
    tunnel.handleLockChanged(prot);
    lhr.handleLockChanged(prot);
  });

  return { auth, passkeys, tunnel, lhr };
}

/**
 * Tunnel yang aktif sebelum restart dinyalakan lagi setelah server listen.
 * Port nyata diketahui setelah `serve` (port 0 di test) — factory default
 * memakai `port` yang diminta, sama seperti yang dicetak dashboard.
 * Hanya penyedia terpilih yang dinyalakan ulang (satu tunnel aktif).
 */
export function autoStartSelectedTunnel(store: SessionStore, access: Access): void {
  if (store.getTunnelSettings(Date.now()).provider === "lhr") access.lhr.autoStart();
  else access.tunnel.autoStart();
}
