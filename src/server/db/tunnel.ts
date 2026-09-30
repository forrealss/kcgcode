/**
 * Repository akun tunnel (`tunnel_account`, id = 1): hasil device flow
 * kcgcode-rp — device token, subdomain, dan tunnel_secret frpc.
 */
import type { Database } from "bun:sqlite";

export interface TunnelAccount {
  email: string;
  username: string;
  subdomain: string;
  deviceId: string;
  deviceToken: string;
  tunnelSecret: string;
}

/** Penyedia remote access: layanan bawaan KCG Code atau localhost.run. */
export type TunnelProvider = "kcg" | "lhr";

export interface TunnelSettings {
  account: TunnelAccount | null;
  /** Tunnel dinyalakan -> dijalankan ulang otomatis saat kcgcode start. */
  enabled: boolean;
  /** Penyedia yang dipilih pengguna (hanya satu yang aktif). */
  provider: TunnelProvider;
  /** localhost.run dinyalakan -> dijalankan ulang otomatis saat start. */
  lhrEnabled: boolean;
  updatedAt: number;
}

interface Row {
  email: string | null;
  username: string | null;
  subdomain: string | null;
  device_id: string | null;
  device_token: string | null;
  tunnel_secret: string | null;
  enabled: number;
  provider: string | null;
  lhr_enabled: number | null;
  updated_at: number;
}

function mapRow(r: Row): TunnelSettings {
  const { email, username, subdomain, device_id, device_token, tunnel_secret } = r;
  return {
    account:
      email && username && subdomain && device_id && device_token && tunnel_secret
        ? {
            email,
            username,
            subdomain,
            deviceId: device_id,
            deviceToken: device_token,
            tunnelSecret: tunnel_secret,
          }
        : null,
    enabled: r.enabled === 1,
    provider: r.provider === "lhr" ? "lhr" : "kcg",
    lhrEnabled: r.lhr_enabled === 1,
    updatedAt: r.updated_at,
  };
}

export function createTunnelRepo(db: Database) {
  const q = {
    ensure: db.query("INSERT OR IGNORE INTO tunnel_account (id, updated_at) VALUES (1, ?)"),
    get: db.query(
      `SELECT email, username, subdomain, device_id, device_token, tunnel_secret, enabled,
              provider, lhr_enabled, updated_at FROM tunnel_account WHERE id = 1`,
    ),
    setAccount: db.query(
      `UPDATE tunnel_account SET email = ?, username = ?, subdomain = ?, device_id = ?,
              device_token = ?, tunnel_secret = ?, updated_at = ? WHERE id = 1`,
    ),
    setSecret: db.query("UPDATE tunnel_account SET tunnel_secret = ?, updated_at = ? WHERE id = 1"),
    setEnabled: db.query("UPDATE tunnel_account SET enabled = ?, updated_at = ? WHERE id = 1"),
    setProvider: db.query("UPDATE tunnel_account SET provider = ?, updated_at = ? WHERE id = 1"),
    setLhrEnabled: db.query(
      "UPDATE tunnel_account SET lhr_enabled = ?, updated_at = ? WHERE id = 1",
    ),
  };

  function ensure(now: number): void {
    q.ensure.run(now);
  }

  return {
    getTunnelSettings(now: number): TunnelSettings {
      ensure(now);
      return mapRow(q.get.get() as Row);
    },
    /** Simpan akun (null = sign out). */
    setTunnelAccount(account: TunnelAccount | null, now: number): void {
      ensure(now);
      q.setAccount.run(
        account?.email ?? null,
        account?.username ?? null,
        account?.subdomain ?? null,
        account?.deviceId ?? null,
        account?.deviceToken ?? null,
        account?.tunnelSecret ?? null,
        now,
      );
    },
    setTunnelSecret(secret: string, now: number): void {
      ensure(now);
      q.setSecret.run(secret, now);
    },
    setTunnelEnabled(enabled: boolean, now: number): void {
      ensure(now);
      q.setEnabled.run(enabled ? 1 : 0, now);
    },
    setTunnelProvider(provider: TunnelProvider, now: number): void {
      ensure(now);
      q.setProvider.run(provider, now);
    },
    setLhrEnabled(enabled: boolean, now: number): void {
      ensure(now);
      q.setLhrEnabled.run(enabled ? 1 : 0, now);
    },
  };
}

export type TunnelRepo = ReturnType<typeof createTunnelRepo>;
