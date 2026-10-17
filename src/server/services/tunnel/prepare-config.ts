/**
 * Siapkan file config frpc lokal: hanya serverAddr/serverPort yang diambil
 * dari VPS (atau cache lokal bila VPS tak terjangkau); sisanya dibangun ulang
 * di sini agar VPS tidak bisa menyisipkan proxy/plugin lain. Ditulis mode 0600.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { TunnelAccount } from "../../db/tunnel";
import type { Result } from "../../result";
import type { TunnelApi } from "../tunnel-api";
import { buildFrpcConfig, frpcLocalIp, parseFrpServer } from "./frpc-config";
import type { TunnelLogFn } from "./types";

export interface PrepareConfigDeps {
  api: TunnelApi;
  configPath: string;
  localHost: string;
  localPort: number;
  /** Port listener Preview; null = tanpa proxy `<user>--preview`. */
  previewPort?: number | null;
  log: TunnelLogFn;
}

/** Siapkan config lokal: segarkan dari VPS bila bisa, pakai cache bila tidak. */
export async function prepareFrpcConfig(
  deps: PrepareConfigDeps,
  account: TunnelAccount,
): Promise<Result<string>> {
  const { api, configPath, localPort, log } = deps;
  let server: { addr: string; port: number } | null = null;
  const fresh = await api.fetchConfig(account.deviceToken, localPort);
  if (fresh.ok) {
    server = parseFrpServer(fresh.data);
    if (!server) return { ok: false, error: "TUNNEL_API_UNREACHABLE" };
  } else if (fresh.error === "TUNNEL_DEVICE_REVOKED") {
    return fresh;
  } else if (existsSync(configPath)) {
    // VPS tak terjangkau: secret lokal masih berlaku.
    server = parseFrpServer(readFileSync(configPath, "utf8"));
    if (server) log(`Using cached tunnel config (${fresh.error}).`);
  }
  if (!server) return { ok: false, error: fresh.ok ? "TUNNEL_API_UNREACHABLE" : fresh.error };

  const toml = buildFrpcConfig({
    serverAddr: server.addr,
    serverPort: server.port,
    username: account.username,
    tunnelSecret: account.tunnelSecret,
    localIp: frpcLocalIp(deps.localHost),
    localPort,
    previewPort: deps.previewPort ?? null,
  });
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, toml, { encoding: "utf8", mode: 0o600 });
  chmodSync(configPath, 0o600);
  return { ok: true, data: configPath };
}
