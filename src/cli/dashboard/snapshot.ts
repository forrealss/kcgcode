/** Model data dashboard: `DashboardSnapshot` dan cara menghitungnya dari server. */
import { networkInterfaces } from "node:os";
import type { KcgServer } from "../../server/app";
import type { UpdateInfo } from "../../server/services/update-check";
import type { KeepAwake } from "../keep-awake";

export type TunnelProviderId = "kcg" | "lhr";

interface KcgTunnelStatus {
  phase: string;
  account?: { url: string } | null;
  pairing?: {
    userCode: string;
    verificationUriComplete: string;
  } | null;
  error?: string | null;
}

interface LhrTunnelStatus {
  phase: string;
  url?: string | null;
  error?: string | null;
  enabled?: boolean;
}

export interface DashboardInfo {
  server: KcgServer & {
    lhr?: { status: () => LhrTunnelStatus };
    tunnelProvider?: () => TunnelProviderId;
  };
  port: number;
  hostname: string;
  /** Status pencegah sleep; tidak ada = baris "Awake" disembunyikan. */
  keepAwake?: Pick<KeepAwake, "status">;
  /** Catatan port saat startup, mis. "3000 in use" (port otomatis diganti). */
  portNote?: string | null;
  /** true selama server di-restart (ganti port) — store lama sudah ditutup. */
  restarting?: boolean;
  /** Waktu server mulai (untuk uptime). */
  startedAt?: number;
}

/**
 * Mode dashboard:
 * - `foreground`: server jalan di proses ini; q menghentikan server.
 * - `background`: dashboard memantau daemon lewat `daemon.json`; q hanya
 *   menutup dashboard, server tetap jalan.
 */
export type DashboardMode = "foreground" | "background";

/**
 * Data siap-tampil dashboard. Dihitung dari server lokal (`takeSnapshot`)
 * atau dibaca dari state daemon — UI tidak menyentuh server langsung.
 */
export interface DashboardSnapshot {
  mode: DashboardMode;
  port: number;
  pid: number;
  memory: string;
  startedAt: number;
  localUrl: string;
  networkUrl: string | null;
  /** URL terbaik untuk HP (QR / Copy). */
  target: { label: string; url: string };
  publicUrl: string | null;
  tunnel: { text: string; color: string };
  pairingUri: string | null;
  tunnelDetail: {
    provider: TunnelProviderId | null;
    kcg: { phase: string; url: string | null };
    lhr: { phase: string; url: string | null } | null;
  };
  keepAwake: { text: string; active: boolean } | null;
  sessions: number;
  running: number;
  projects: number;
  portNote: string | null;
  restarting: boolean;
  /** Teks status selama `restarting`, mis. "Stopping…". Default "Restarting…". */
  busyLabel?: string | null;
  /** Versi baru di npm (opsional: state daemon versi lama tidak membawanya). */
  update?: UpdateInfo | null;
}

export function formatUptime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

/** Provider tunnel terpilih ("kcg" | "lhr"); null bila tak diketahui. */
export function activeProvider(info: DashboardInfo): TunnelProviderId | null {
  try {
    const fn = info.server.tunnelProvider;
    if (typeof fn === "function") return fn.call(info.server);
    const viaStore = (
      info.server as unknown as {
        store?: { getTunnelSettings?: (now: number) => { provider: TunnelProviderId } };
      }
    ).store?.getTunnelSettings?.(Date.now())?.provider;
    if (viaStore === "kcg" || viaStore === "lhr") return viaStore;
  } catch {
    // abaikan — fallback di bawah
  }
  return null;
}

function kcgStatus(info: DashboardInfo): KcgTunnelStatus {
  try {
    return info.server.tunnel.status() as unknown as KcgTunnelStatus;
  } catch {
    return { phase: "error", account: null, error: "status gagal dibaca" };
  }
}

function lhrStatus(info: DashboardInfo): LhrTunnelStatus | null {
  try {
    const lhr = info.server.lhr;
    if (!lhr) return null;
    return lhr.status();
  } catch {
    return { phase: "error", url: null, error: "status gagal dibaca" };
  }
}

/** URL terbaik untuk dibuka dari HP: publik aktif > publik lain > LAN > local. */
export function bestUrl(info: DashboardInfo): { label: string; url: string } {
  const provider = activeProvider(info);
  const kcg = kcgStatus(info);
  const lhr = lhrStatus(info);
  const kcgUrl = kcg.account && kcg.phase === "online" ? kcg.account.url : null;
  const lhrUrl = lhr && lhr.phase === "online" && lhr.url ? lhr.url : null;

  if (provider === "lhr" && lhrUrl) return { label: "public (lhr)", url: lhrUrl };
  if (provider === "kcg" && kcgUrl) return { label: "public (kcg)", url: kcgUrl };
  // Provider tak diketahui / belum online: pakai mana pun yang online.
  if (kcgUrl) return { label: "public (kcg)", url: kcgUrl };
  if (lhrUrl) return { label: "public (lhr)", url: lhrUrl };
  const urls = localUrls(info.hostname, info.port);
  return urls.find((u) => u.label === "network") ?? (urls[0] as { label: string; url: string });
}

function localUrls(hostname: string, port: number): { label: string; url: string }[] {
  const urls: { label: string; url: string }[] = [];
  const host = hostname === "0.0.0.0" || hostname === "::" ? "localhost" : hostname;
  urls.push({ label: "local", url: `http://${host}:${port}` });

  if (hostname === "127.0.0.1" || hostname === "localhost") {
    return urls;
  }

  for (const infos of Object.values(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === "IPv4" && !info.internal) {
        urls.push({ label: "network", url: `http://${info.address}:${port}` });
      }
    }
  }
  return urls;
}

function activityStats(app: KcgServer) {
  try {
    const projects = app.store.listProjects().length;
    const sessions = app.store.listSessions();
    const running = sessions.filter((s) => s.status === "running");
    return { projects, sessions: sessions.length, running };
  } catch {
    // Store sedang ditutup (restart ganti port).
    return { projects: 0, sessions: 0, running: [] };
  }
}

function availableUpdate(app: KcgServer): UpdateInfo | null {
  try {
    return app.updates?.available() ?? null;
  } catch {
    return null;
  }
}

function formatMemory(): string {
  const rss = process.memoryUsage().rss / 1024 / 1024;
  if (rss >= 1024) return `${(rss / 1024).toFixed(1)} GB`;
  return `${rss.toFixed(1)} MB`;
}

/** Ringkasan satu baris tunnel aktif: "lhr · online" / "kcg · off" / pairing. URL publik punya baris sendiri. */
function tunnelSummary(info: DashboardInfo): { text: string; color: string } {
  const provider = activeProvider(info);
  const kcg = kcgStatus(info);
  const lhr = lhrStatus(info);
  if (kcg.pairing && !(kcg.phase === "online" && kcg.account)) {
    return { text: `pairing code ${kcg.pairing.userCode}`, color: "yellow" };
  }
  const active = provider === "lhr" ? lhr : kcg.account ? kcg : lhr;
  if (!active) return { text: `${provider ?? "kcg"} · off`, color: "gray" };
  if (provider === "lhr" && lhr) {
    if (lhr.phase === "online" && lhr.url) return { text: "lhr · online", color: "green" };
    return { text: `lhr · ${lhr.phase === "stopped" ? "off" : lhr.phase}`, color: "gray" };
  }
  if (kcg.phase === "online" && kcg.account?.url) return { text: "kcg · online", color: "green" };
  if (kcg.error && provider !== "lhr") return { text: `kcg · ${kcg.error}`, color: "red" };
  return {
    text: `kcg · ${kcg.phase === "stopped" || kcg.phase === "signed_out" ? "off" : kcg.phase}`,
    color: "gray",
  };
}

function keepAwakeText(keepAwake: Pick<KeepAwake, "status">): { text: string; active: boolean } {
  const st = keepAwake.status();
  return {
    active: st.active,
    text: st.active
      ? `on · sleep blocked (${st.method})`
      : `off${st.error ? ` · ${st.error}` : ""}`,
  };
}

/** Hitung data tampilan dari server yang berjalan di proses ini. */
export function takeSnapshot(
  info: DashboardInfo,
  mode: DashboardMode = "foreground",
): DashboardSnapshot {
  const urls = localUrls(info.hostname, info.port);
  const { projects, sessions, running } = activityStats(info.server);
  const target = bestUrl(info);
  const kcg = kcgStatus(info);
  const lhr = lhrStatus(info);
  const tunnel = tunnelSummary(info);
  return {
    mode,
    port: info.port,
    pid: process.pid,
    memory: formatMemory(),
    startedAt: info.startedAt ?? Date.now(),
    localUrl: urls[0]?.url ?? target.url,
    networkUrl: urls.find((u) => u.label === "network")?.url ?? null,
    target,
    publicUrl: target.label.startsWith("public") ? target.url : null,
    tunnel,
    pairingUri:
      kcg.pairing && tunnel.color === "yellow" ? kcg.pairing.verificationUriComplete : null,
    tunnelDetail: {
      provider: activeProvider(info),
      kcg: { phase: kcg.phase, url: kcg.account?.url ?? null },
      lhr: lhr ? { phase: lhr.phase, url: lhr.url ?? null } : null,
    },
    keepAwake: info.keepAwake ? keepAwakeText(info.keepAwake) : null,
    sessions,
    running: running.length,
    projects,
    portNote: info.portNote ?? null,
    restarting: Boolean(info.restarting),
    update: availableUpdate(info.server),
  };
}
