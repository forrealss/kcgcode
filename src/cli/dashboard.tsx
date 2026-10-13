/**
 * Dashboard terminal live untuk server kcgcode — dirender lewat Ink.
 *
 * Alternate screen + frame update in-place; layout modern dengan card.
 */
import { networkInterfaces } from "node:os";
import { Box, render, renderToString, Text, useInput } from "ink";
import type { ReactNode } from "react";
import { renderUnicodeCompact } from "uqr";
import type { KcgServer } from "../server/app";
import { InkReact } from "./ink-react";
import type { KeepAwake } from "./keep-awake";
import { logoLines, readPackageVersion } from "./theme";

// Hook wajib dari instance React milik Ink — lihat ink-react.ts.
const { useEffect, useReducer, useRef, useState } = InkReact;

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
}

export interface DashboardCallbacks {
  /** q / Ctrl+C. Foreground: hentikan server. Background: tutup dashboard saja. */
  onQuit: (reason: string) => void;
  /** Buka URL dashboard di browser default. */
  onOpenUrl: () => void | Promise<void>;
  /** Simpan port ke config & restart server. Resolve null = sukses, string = error. */
  onChangePort: (port: number) => Promise<string | null>;
  /** Foreground: pindahkan server ke background (daemon) lalu keluar. */
  onBackground: () => void;
  /** Background: hentikan daemon. */
  onStop: () => void;
  /** Background: hentikan daemon lalu jalankan server di terminal ini. */
  onForeground: () => void;
}

const REFRESH_MS = 1000;
const PAD = 2;
const FLASH_MS = 2500;
const COMPACT_BELOW = 64;
const CONFIRM_MS = 3000;
/** Lebar kolom label di card status. */
const LABEL_W = 8;

/** State tampilan dinamis; semua opsional untuk render statis. */
export interface DashboardViewState {
  showQr?: boolean;
  showDetail?: boolean;
  /** Index menu yang disorot (0..menuItems().length-1). */
  menuIndex?: number;
  flash?: string | null;
  /** Menunggu tekan kedua untuk aksi yang memutus session running. */
  confirm?: ConfirmAction | null;
  /** Isi input port saat mode "Change port" aktif; null = tidak sedang mengisi. */
  portInput?: string | null;
  portError?: string | null;
}

export type ConfirmAction = "quit" | "background" | "stop" | "foreground";

export interface MenuItem {
  id: "open" | "copy" | "qr" | "detail" | "port" | "background" | "foreground" | "stop" | "quit";
  key: string;
  label: string;
}

export function menuItems(
  view: Pick<DashboardViewState, "showQr" | "showDetail"> = {},
  mode: DashboardMode = "foreground",
): MenuItem[] {
  const common: MenuItem[] = [
    { id: "open", key: "o", label: "Open in browser" },
    { id: "copy", key: "c", label: "Copy URL" },
    { id: "qr", key: "m", label: view.showQr ? "Hide phone QR" : "Show phone QR" },
    {
      id: "detail",
      key: "t",
      label: view.showDetail ? "Hide tunnel detail" : "Tunnel detail",
    },
    { id: "port", key: "p", label: "Change port" },
  ];
  if (mode === "background") {
    return [
      ...common,
      { id: "foreground", key: "f", label: "Run in foreground" },
      { id: "stop", key: "s", label: "Stop server" },
      { id: "quit", key: "q", label: "Close dashboard" },
    ];
  }
  return [
    ...common,
    { id: "background", key: "b", label: "Run in background" },
    { id: "quit", key: "q", label: "Quit" },
  ];
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

/** Salin teks ke clipboard (OSC 52 — didukung sebagian besar terminal modern). */
export function copyToClipboard(text: string): void {
  const b64 = Buffer.from(text, "utf8").toString("base64");
  process.stdout.write(`\u001b]52;c;${b64}\u0007`);
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

/** URL tanpa skema — lebih ringkas untuk hint menu. */
function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, "");
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
  };
}

/** Deskripsi kanan tiap item menu. */
function menuHint(id: MenuItem["id"], snap: DashboardSnapshot): string {
  const running = snap.running;
  if (id === "open") return shortUrl(snap.localUrl);
  if (id === "copy") return `${snap.target.label} URL`;
  if (id === "qr") return "scan from your phone";
  if (id === "detail") return snap.tunnel.text;
  if (id === "port") return `current ${snap.port}`;
  if (id === "background") return "keeps running after terminal closes";
  if (id === "foreground") return "move the server into this terminal";
  if (id === "stop")
    return running > 0 ? `stop server · ${running} running` : "stop the background server";
  if (snap.mode === "background") return "server keeps running";
  return running > 0 ? `stop server · ${running} running` : "stop server & exit";
}

const plural = (n: number) => `${n} session${n === 1 ? "" : "s"}`;

const CONFIRM_TEXT: Record<ConfirmAction, (n: number) => string> = {
  quit: (n) => `! ${plural(n)} running — press q again to stop`,
  stop: (n) => `! ${plural(n)} running — press s again to stop`,
  background: (n) => `! ${plural(n)} running will be interrupted — press b again`,
  foreground: (n) => `! ${plural(n)} running will be interrupted — press f again`,
};

function Card({
  title,
  badge,
  badgeColor = "green",
  width,
  children,
}: {
  title: string;
  badge?: string;
  badgeColor?: string;
  width?: number;
  children: ReactNode;
}) {
  return (
    <Box
      width={width}
      borderStyle="round"
      borderColor="gray"
      flexDirection="column"
      paddingX={2}
      paddingY={0}
    >
      <Box justifyContent="space-between" marginBottom={0}>
        <Text color="cyan" bold>
          {title}
        </Text>
        {badge && (
          <Text color={badgeColor} bold>
            {badge}
          </Text>
        )}
      </Box>
      <Box flexDirection="column" gap={0}>
        {children}
      </Box>
    </Box>
  );
}

export function Brand({ version, compact }: { version: string; compact?: boolean }) {
  const logos = logoLines();
  if (compact) {
    return (
      <Box gap={1}>
        <Box flexShrink={0} gap={1}>
          <Text bold color="cyan">
            ▍kcgcode
          </Text>
          <Text color="cyan">v{version}</Text>
        </Box>
        <Text dimColor wrap="truncate-end">
          · mobile control for CLI agents
        </Text>
      </Box>
    );
  }
  return (
    <Box gap={3} alignItems="center">
      <Box flexDirection="column">
        {logos.map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static logo lines
          <Text key={i} color="cyan" bold>
            {line}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" gap={0}>
        <Box gap={1} alignItems="baseline">
          <Text bold color="white">
            kcgcode
          </Text>
          <Text color="cyan" bold>
            v{version}
          </Text>
        </Box>
        <Text dimColor>mobile control for CLI agents</Text>
        <Text dimColor>opencode · claude code</Text>
      </Box>
    </Box>
  );
}

const TUNNEL_COLOR: Record<string, string> = {
  online: "green",
  connecting: "yellow",
  starting: "yellow",
  reconnecting: "yellow",
  error: "red",
};

/** Rincian kedua tunnel — dibuka lewat menu (t). */
function TunnelDetailCard({
  detail,
  width,
}: {
  detail: DashboardSnapshot["tunnelDetail"];
  width?: number;
}) {
  const { provider, kcg, lhr } = detail;
  return (
    <Card title="TUNNEL DETAIL" badge={provider ?? "—"} badgeColor="cyan" width={width}>
      <InfoRow label="kcg phase" width={10}>
        <Text color={TUNNEL_COLOR[kcg.phase] ?? "white"}>{kcg.phase}</Text>
      </InfoRow>
      <InfoRow label="kcg url" width={10}>
        <Text color={kcg.url ? "cyan" : "gray"}>{kcg.url ?? "—"}</Text>
      </InfoRow>
      {lhr ? (
        <>
          <InfoRow label="lhr phase" width={10}>
            <Text color={TUNNEL_COLOR[lhr.phase] ?? "white"}>{lhr.phase}</Text>
          </InfoRow>
          <InfoRow label="lhr url" width={10}>
            <Text color={lhr.url ? "cyan" : "gray"}>{lhr.url ?? "—"}</Text>
          </InfoRow>
        </>
      ) : (
        <InfoRow label="lhr" width={10}>
          <Text dimColor>tidak tersedia</Text>
        </InfoRow>
      )}
      <Box marginTop={0}>
        <Text dimColor>Ganti provider di Settings → Remote access.</Text>
      </Box>
    </Card>
  );
}

interface DashboardUIProps {
  snap: DashboardSnapshot;
  version: string;
  view?: DashboardViewState;
}

function DashboardUI({ snap, version, view = {} }: DashboardUIProps) {
  const background = snap.mode === "background";
  const items = menuItems(view, snap.mode);
  const menuIndex = Math.min(Math.max(view.menuIndex ?? 0, 0), items.length - 1);
  const { running, target } = snap;

  const terminalWidth = process.stdout.columns ?? 72;
  const cardWidth = Math.min(68, Math.max(36, terminalWidth - 4));
  const compact = terminalWidth < COMPACT_BELOW;
  const uptime = formatUptime(Date.now() - snap.startedAt);
  const labelWidth = Math.max(...items.map((i) => i.label.length));
  const panelOpen = Boolean(view.showQr || view.showDetail);
  const editingPort = view.portInput != null;
  const quitHint = background ? "q close" : "q quit";

  return (
    // Wrapper selebar terminal agar blok konten berada di tengah secara horizontal
    <Box width={terminalWidth} flexDirection="column" alignItems="center">
      <Box flexDirection="column" paddingX={PAD} paddingY={1} gap={1} width={cardWidth + PAD * 2}>
        {/* Dekorasi KCG tetap di atas */}
        <Brand version={version} compact={compact} />

        {/* Status server: header Running + uptime, lalu URL & info proses */}
        <Box
          width={cardWidth}
          borderStyle="round"
          borderColor="cyan"
          flexDirection="column"
          paddingX={2}
          paddingY={0}
        >
          <Box justifyContent="space-between" marginBottom={1}>
            {snap.restarting ? (
              <Text color="yellow" bold>
                ◌ {snap.busyLabel ?? "Restarting…"}
              </Text>
            ) : (
              <Text color="green" bold>
                ● Running{background ? " in background" : ""}
              </Text>
            )}
            <Text dimColor>up {uptime}</Text>
          </Box>
          <InfoRow label="Local">
            <Text color="cyan">{snap.localUrl}</Text>
            {snap.portNote && <Text color="yellow">({snap.portNote})</Text>}
          </InfoRow>
          {snap.networkUrl && (
            <InfoRow label="Network">
              <Text color="cyan">{snap.networkUrl}</Text>
            </InfoRow>
          )}
          {snap.publicUrl && (
            <InfoRow label="Public">
              <Text color="cyan" bold>
                {snap.publicUrl}
              </Text>
            </InfoRow>
          )}
          <InfoRow label="Tunnel">
            <Text color={snap.tunnel.color}>{snap.tunnel.text}</Text>
          </InfoRow>
          {snap.pairingUri && (
            <InfoRow label="Pair at">
              <Text color="yellow">{snap.pairingUri}</Text>
            </InfoRow>
          )}
          {snap.keepAwake && (
            <InfoRow label="Awake">
              <Text color={snap.keepAwake.active ? "green" : "yellow"} wrap="truncate-end">
                {snap.keepAwake.text}
              </Text>
            </InfoRow>
          )}
          <InfoRow label="Sessions">
            <Text color="white">{snap.sessions}</Text>
            <Text dimColor>·</Text>
            <Text color={running > 0 ? "green" : "white"}>{running} running</Text>
            <Text dimColor>·</Text>
            <Text color="white">
              {snap.projects} {snap.projects === 1 ? "project" : "projects"}
            </Text>
          </InfoRow>
          <InfoRow label="Process">
            <Text color="white">PID {snap.pid}</Text>
            <Text dimColor>·</Text>
            <Text color="white">{snap.memory}</Text>
          </InfoRow>
        </Box>

        {view.showQr && <QrCard target={target} width={cardWidth} />}
        {view.showDetail && <TunnelDetailCard detail={snap.tunnelDetail} width={cardWidth} />}
        {editingPort && (
          <PortCard
            value={view.portInput ?? ""}
            error={view.portError ?? null}
            current={snap.port}
            running={running}
            busy={snap.restarting}
            width={cardWidth}
          />
        )}

        {/* Menu: tombol shortcut + label rata kolom + hint terpotong rapi */}
        <Box
          width={cardWidth}
          borderStyle="round"
          borderColor="gray"
          flexDirection="column"
          paddingX={1}
          paddingY={0}
        >
          {items.map((item, idx) => {
            const hint = menuHint(item.id, snap);
            const selected = idx === menuIndex;
            return (
              <Box key={item.id} paddingX={1} backgroundColor={selected ? "blue" : undefined}>
                <Box flexShrink={0}>
                  <Text color={selected ? "white" : "cyan"} bold>
                    {selected ? "▶ " : "  "}
                    {item.key}
                    {"  "}
                  </Text>
                  <Text color="white" bold={selected}>
                    {item.label.padEnd(labelWidth + 2)}
                  </Text>
                </Box>
                <Box flexShrink={1}>
                  <Text color={selected ? "white" : "gray"} wrap="truncate-end">
                    {hint}
                  </Text>
                </Box>
              </Box>
            );
          })}
        </Box>

        <Box justifyContent="center" paddingX={1}>
          <Text dimColor wrap="truncate-end">
            {editingPort
              ? "type a port · ⏎ save & restart · esc cancel"
              : compact
                ? `↑↓ move · ⏎ select · ${quitHint}`
                : `↑↓ move · ⏎ select · letter = shortcut${panelOpen ? " · esc close" : ""} · ${quitHint}`}
          </Text>
        </Box>
        <Box justifyContent="center" height={1}>
          {view.confirm ? (
            <Text color="yellow" bold>
              {CONFIRM_TEXT[view.confirm](running)}
            </Text>
          ) : view.flash ? (
            <Text color="green">✓ {view.flash}</Text>
          ) : (
            <Text dimColor> </Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}

/** Form ganti port: input angka, validasi, dan peringatan session running. */
function PortCard({
  value,
  error,
  current,
  running,
  busy,
  width,
}: {
  value: string;
  error: string | null;
  current: number;
  running: number;
  busy: boolean;
  width: number;
}) {
  return (
    <Card title="CHANGE PORT" badge={`current ${current}`} badgeColor="cyan" width={width}>
      <Box marginTop={1} gap={1}>
        <Text dimColor>New port</Text>
        <Text color="cyan" bold>
          ›
        </Text>
        <Text color="white" bold>
          {value}
        </Text>
        {!busy && <Text color="cyan">▌</Text>}
      </Box>
      <Box marginTop={1} flexDirection="column">
        {busy ? (
          <Text color="yellow">Restarting server…</Text>
        ) : error ? (
          <Text color="red">✗ {error}</Text>
        ) : (
          <Text dimColor>Saved to config · server restarts on the new port.</Text>
        )}
        {running > 0 && !busy && (
          <Text color="yellow">
            ! {running} running session{running === 1 ? "" : "s"} will be interrupted.
          </Text>
        )}
      </Box>
    </Card>
  );
}

/** Baris label (rata kiri, lebar tetap) + nilai. */
function InfoRow({
  label,
  width = LABEL_W,
  children,
}: {
  label: string;
  width?: number;
  children: ReactNode;
}) {
  return (
    <Box gap={1}>
      <Box flexShrink={0} width={width}>
        <Text dimColor>{label}</Text>
      </Box>
      <Box flexShrink={1} gap={1}>
        {children}
      </Box>
    </Box>
  );
}

/** QR code untuk membuka dashboard dari HP. */
function QrCard({ target, width }: { target: { label: string; url: string }; width: number }) {
  const qr = renderUnicodeCompact(target.url, { border: 1 });
  return (
    <Card title="OPEN ON PHONE" badge={target.label} badgeColor="cyan" width={width}>
      <Box flexDirection="column" alignItems="center">
        <Text>{qr}</Text>
        <Text color="cyan">{target.url}</Text>
      </Box>
    </Card>
  );
}

/** Frame string (non-TTY / test). */
export function renderDashboard(
  info: DashboardInfo,
  version: string,
  view: DashboardViewState = {},
): string {
  return renderSnapshot(takeSnapshot(info), version, view);
}

export function renderSnapshot(
  snap: DashboardSnapshot,
  version: string,
  view: DashboardViewState = {},
): string {
  return renderToString(<DashboardUI snap={snap} version={version} view={view} />);
}

/** Sumber data dashboard — dibaca ulang setiap render. */
export type SnapshotSource = () => DashboardSnapshot;

interface DashboardAppProps {
  source: SnapshotSource;
  version: string;
  callbacks: DashboardCallbacks;
}

/** Validasi isi input port; null = valid. */
export function portInputError(raw: string): string | null {
  if (raw === "") return "Enter a port number";
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return "Port must be between 1 and 65535";
  if (n < 1024) return "Ports below 1024 need root — pick 1024 or higher";
  return null;
}

function DashboardApp({ source, version, callbacks }: DashboardAppProps) {
  const { onQuit, onOpenUrl, onChangePort, onBackground, onStop, onForeground } = callbacks;
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const snap = source();
  const background = snap.mode === "background";
  const [showQr, setShowQr] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [menuIndex, setMenuIndex] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const [confirm, setConfirmState] = useState<ConfirmAction | null>(null);
  const [portInput, setPortInputState] = useState<string | null>(null);
  // Ink bisa memproses beberapa tombol sebelum re-render; handler membaca ref
  // agar tidak memakai nilai state yang basi.
  const confirmRef = useRef<ConfirmAction | null>(null);
  const portRef = useRef<string | null>(null);
  const setConfirm = (v: ConfirmAction | null) => {
    confirmRef.current = v;
    setConfirmState(v);
  };
  const setPortInput = (v: string | null) => {
    portRef.current = v;
    setPortInputState(v);
  };
  const [portError, setPortError] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const id = setInterval(tick, REFRESH_MS);
    return () => {
      clearInterval(id);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    };
  }, []);

  const notify = (msg: string) => {
    setFlash(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
  };

  /**
   * Aksi yang memutus session running (quit / background) butuh tekan kedua
   * dalam CONFIRM_MS. Tanpa session running langsung dijalankan.
   */
  const confirmed = (action: ConfirmAction): boolean => {
    if (source().running === 0 || confirmRef.current === action) {
      setConfirm(null);
      return true;
    }
    setConfirm(action);
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => setConfirm(null), CONFIRM_MS);
    return false;
  };

  const doOpen = () => {
    void onOpenUrl();
    notify(`Opening ${shortUrl(source().localUrl)}…`);
  };
  const doCopy = () => {
    // Tampilkan URL-nya juga: terminal tanpa dukungan OSC 52 tetap bisa disalin manual.
    const t = source().target;
    copyToClipboard(t.url);
    notify(`Copied ${t.url}`);
  };
  const doQuit = () => {
    // Background: q hanya menutup dashboard — tidak ada yang terputus.
    if (background || confirmed("quit")) onQuit("quit");
  };
  const doStop = () => {
    if (confirmed("stop")) onStop();
  };
  const doForeground = () => {
    if (confirmed("foreground")) onForeground();
  };
  const doBackground = () => {
    if (confirmed("background")) onBackground();
  };
  const openPortInput = () => {
    setPortInput(String(source().port));
    setPortError(null);
  };
  const submitPort = async (raw: string) => {
    const err = portInputError(raw);
    if (err) {
      setPortError(err);
      return;
    }
    const next = Number(raw);
    const prev = source().port;
    setPortError(null);
    // onChangePort menyetel status restarting secara sinkron — render segera.
    const pending = onChangePort(next);
    tick();
    const failed = await pending;
    if (failed) {
      setPortError(failed);
      return;
    }
    setPortInput(null);
    notify(next === prev ? `Port ${next} saved to config` : `Server restarted on port ${next}`);
  };

  const activate = (index: number) => {
    const items = menuItems({ showQr, showDetail }, snap.mode);
    const item = items[index];
    if (!item) return;
    if (item.id === "open") doOpen();
    else if (item.id === "copy") doCopy();
    else if (item.id === "qr") setShowQr((v) => !v);
    else if (item.id === "detail") setShowDetail((v) => !v);
    else if (item.id === "port") openPortInput();
    else if (item.id === "background") doBackground();
    else if (item.id === "foreground") doForeground();
    else if (item.id === "stop") doStop();
    else if (item.id === "quit") doQuit();
  };

  /** Mode input port: hanya angka, backspace, enter, esc yang diproses. */
  const handlePortKey = (
    current: string,
    input: string,
    key: Parameters<Parameters<typeof useInput>[0]>[1],
  ) => {
    // Abaikan input selama restart berjalan.
    if (source().restarting) return;
    if (key.escape) {
      setPortInput(null);
      setPortError(null);
    } else if (key.return) {
      void submitPort(current);
    } else if (key.backspace || key.delete) {
      setPortInput(current.slice(0, -1));
      setPortError(null);
    } else {
      const digits = input.replace(/\D/g, "");
      const next = (current + digits).slice(0, 5);
      if (digits) {
        setPortInput(next);
        setPortError(null);
      }
      // Paste "4000⏎" tiba sebagai satu chunk tanpa flag return.
      if (/[\r\n]/.test(input)) void submitPort(next);
    }
  };

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      onQuit("Ctrl+C");
      return;
    }
    if (portRef.current !== null) {
      handlePortKey(portRef.current, input, key);
      return;
    }
    if (key.escape) {
      if (confirmRef.current) {
        setConfirm(null);
        return;
      }
      if (showQr || showDetail) {
        setShowQr(false);
        setShowDetail(false);
        return;
      }
    }
    const menu = menuItems({}, snap.mode);
    const count = menu.length;
    if (key.upArrow) {
      setMenuIndex((i) => (i + count - 1) % count);
      return;
    }
    if (key.downArrow) {
      setMenuIndex((i) => (i + 1) % count);
      return;
    }
    if (key.return) {
      activate(menuIndex);
      return;
    }
    const k = input.toLowerCase();
    // Shortcut huruf: sorot item terkait lalu jalankan, agar ada umpan balik visual.
    const shortcutIdx = menu.findIndex((item) => item.key === k);
    if (shortcutIdx >= 0) {
      setMenuIndex(shortcutIdx);
      activate(shortcutIdx);
    } else if (k === "j") {
      setMenuIndex((i) => (i + 1) % count);
    } else if (k === "k") {
      setMenuIndex((i) => (i + count - 1) % count);
    } else if (/^[1-9]$/.test(k) && Number(k) <= count) {
      setMenuIndex(Number(k) - 1);
      activate(Number(k) - 1);
    }
  });

  return (
    <DashboardUI
      snap={snap}
      version={version}
      view={{ showQr, showDetail, menuIndex, flash, confirm, portInput, portError }}
    />
  );
}

export interface RunningDashboard {
  stop(): void;
  /** Frame sudah live via Ink; API dipertahankan untuk kompatibilitas. */
  redraw(): void;
}

/**
 * Mulai dashboard live di alternate screen. Kembalikan handle untuk stop.
 * Pastikan `stop()` dipanggil saat shutdown agar terminal pulih.
 */
export async function startDashboard(
  source: SnapshotSource,
  callbacks: Partial<DashboardCallbacks> = {},
): Promise<RunningDashboard> {
  const version = await readPackageVersion();
  const stdout = process.stdout;
  const isTty = Boolean(stdout.isTTY);

  const noop = () => {};
  const cb: DashboardCallbacks = {
    onQuit: callbacks.onQuit ?? noop,
    onOpenUrl: callbacks.onOpenUrl ?? noop,
    onChangePort: callbacks.onChangePort ?? (async () => "not supported"),
    onBackground: callbacks.onBackground ?? noop,
    onStop: callbacks.onStop ?? noop,
    onForeground: callbacks.onForeground ?? noop,
  };

  if (!isTty) {
    stdout.write(`${renderSnapshot(source(), version)}\n`);
    return {
      stop() {},
      redraw() {
        stdout.write(`${renderSnapshot(source(), version)}\n`);
      },
    };
  }

  const instance = render(<DashboardApp source={source} version={version} callbacks={cb} />, {
    alternateScreen: true,
    patchConsole: true,
    exitOnCtrlC: false,
    incrementalRendering: true,
  });

  return {
    stop() {
      instance.unmount();
    },
    redraw() {
      instance.rerender(<DashboardApp source={source} version={version} callbacks={cb} />);
    },
  };
}

/** Coba buka URL di browser default OS. */
export async function openBrowser(url: string): Promise<void> {
  const platform = process.platform;
  let cmd: string[];
  if (platform === "win32") {
    cmd = ["cmd", "/c", "start", "", url];
  } else if (platform === "darwin") {
    cmd = ["open", url];
  } else {
    cmd = ["xdg-open", url];
  }
  try {
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  } catch {
    // diam — user bisa buka manual
  }
}
