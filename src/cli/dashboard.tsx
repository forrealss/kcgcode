/**
 * Dashboard terminal live untuk server kcgcode — dirender lewat Ink.
 *
 * Alternate screen + frame update in-place; layout modern dengan card.
 */
import { networkInterfaces } from "node:os";
import { Box, render, renderToString, Text, useInput } from "ink";
import { type ReactNode, useEffect, useReducer, useRef, useState } from "react";
import { renderUnicodeCompact } from "uqr";
import type { KcgServer } from "../server/app";
import { logoLines, readPackageVersion } from "./theme";

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
}

export interface DashboardCallbacks {
  /** Panggil saat user minta berhenti (q / Ctrl+C). */
  onQuit: (reason: string) => void;
  /** Buka URL dashboard di browser default. */
  onOpenUrl: () => void | Promise<void>;
}

const REFRESH_MS = 1000;
const PAD = 2;
const FLASH_MS = 2500;
const COMPACT_BELOW = 64;

/** State tampilan dinamis; semua opsional untuk render statis. */
export interface DashboardViewState {
  startedAt?: number;
  showQr?: boolean;
  showDetail?: boolean;
  /** Index menu yang disorot (0..MENU_ITEMS.length-1). */
  menuIndex?: number;
  flash?: string | null;
}

export interface MenuItem {
  id: "open" | "copy" | "qr" | "detail" | "quit";
  key: string;
  label: string;
}

export function menuItems(
  view: Pick<DashboardViewState, "showQr" | "showDetail"> = {},
): MenuItem[] {
  return [
    { id: "open", key: "o", label: "Open in browser" },
    { id: "copy", key: "c", label: "Copy URL" },
    { id: "qr", key: "m", label: view.showQr ? "Hide phone QR" : "Show phone QR" },
    {
      id: "detail",
      key: "t",
      label: view.showDetail ? "Hide tunnel detail" : "Tunnel detail (kcg/lhr)",
    },
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
  const projects = app.store.listProjects().length;
  const sessions = app.store.listSessions();
  const running = sessions.filter((s) => s.status === "running");
  return { projects, sessions: sessions.length, running };
}

function formatMemory(): string {
  const rss = process.memoryUsage().rss / 1024 / 1024;
  if (rss >= 1024) return `${(rss / 1024).toFixed(1)} GB`;
  return `${rss.toFixed(1)} MB`;
}

/** Ringkasan satu baris tunnel aktif: "lhr · online https://…" / "kcg · off" / pairing. */
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
    if (lhr.phase === "online" && lhr.url)
      return { text: `lhr · online ${lhr.url}`, color: "green" };
    return { text: `lhr · ${lhr.phase === "stopped" ? "off" : lhr.phase}`, color: "gray" };
  }
  if (kcg.phase === "online" && kcg.account?.url)
    return { text: `kcg · online ${kcg.account.url}`, color: "green" };
  if (kcg.error && provider !== "lhr") return { text: `kcg · ${kcg.error}`, color: "red" };
  return {
    text: `kcg · ${kcg.phase === "stopped" || kcg.phase === "signed_out" ? "off" : kcg.phase}`,
    color: "gray",
  };
}

/** Deskripsi kanan tiap item menu (ala "Opens http://…" di contoh). */
function menuHint(
  id: MenuItem["id"],
  info: DashboardInfo,
  target: { label: string; url: string },
): string {
  const provider = activeProvider(info);
  if (id === "open") return `Opens ${target.url}`;
  if (id === "copy") return `Copy ${target.label} URL`;
  if (id === "qr") return "QR on terminal";
  if (id === "detail") {
    const kcg = kcgStatus(info);
    const lhr = lhrStatus(info);
    const phase = provider === "lhr" ? (lhr?.phase ?? "off") : kcg.phase;
    const short = phase === "stopped" || phase === "signed_out" ? "off" : phase;
    return `Current: ${provider ?? "—"} · ${short}`;
  }
  return "Stop server & exit";
}

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

function Brand({ version, compact }: { version: string; compact?: boolean }) {
  const logos = logoLines();
  if (compact) {
    return (
      <Box gap={1}>
        <Text bold color="cyan">
          ▍kcgcode
        </Text>
        <Text color="cyan">v{version}</Text>
        <Text dimColor>· mobile control for CLI agents</Text>
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
function TunnelDetailCard({ info, width }: { info: DashboardInfo; width?: number }) {
  const provider = activeProvider(info);
  const kcg = kcgStatus(info);
  const lhr = lhrStatus(info);
  return (
    <Card title="TUNNEL DETAIL" badge={provider ?? "—"} badgeColor="cyan" width={width}>
      <Box gap={1}>
        <Text dimColor>{"kcg phase".padEnd(10)}</Text>
        <Text color={TUNNEL_COLOR[kcg.phase] ?? "white"}>{kcg.phase}</Text>
      </Box>
      <Box gap={1}>
        <Text dimColor>{"kcg url".padEnd(10)}</Text>
        <Text color={kcg.account?.url ? "cyan" : "gray"}>{kcg.account?.url ?? "—"}</Text>
      </Box>
      {lhr ? (
        <>
          <Box gap={1}>
            <Text dimColor>{"lhr phase".padEnd(10)}</Text>
            <Text color={TUNNEL_COLOR[lhr.phase] ?? "white"}>{lhr.phase}</Text>
          </Box>
          <Box gap={1}>
            <Text dimColor>{"lhr url".padEnd(10)}</Text>
            <Text color={lhr.url ? "cyan" : "gray"}>{lhr.url ?? "—"}</Text>
          </Box>
        </>
      ) : (
        <Box gap={1}>
          <Text dimColor>{"lhr".padEnd(10)}</Text>
          <Text dimColor>tidak tersedia</Text>
        </Box>
      )}
      <Box marginTop={0}>
        <Text dimColor>Ganti provider di Settings → Remote access.</Text>
      </Box>
    </Card>
  );
}

interface DashboardUIProps {
  info: DashboardInfo;
  version: string;
  view?: DashboardViewState;
}

function DashboardUI({ info, version, view = {} }: DashboardUIProps) {
  const { server, port, hostname } = info;
  const urls = localUrls(hostname, port);
  const { projects, sessions, running } = activityStats(server);
  const target = bestUrl(info);
  const items = menuItems(view);
  const menuIndex = Math.min(Math.max(view.menuIndex ?? 0, 0), items.length - 1);
  const summary = tunnelSummary(info);

  const terminalWidth = process.stdout.columns ?? 72;
  const cardWidth = Math.min(68, Math.max(36, terminalWidth - 4));
  const compact = terminalWidth < COMPACT_BELOW;
  const uptime = view.startedAt ? formatUptime(Date.now() - view.startedAt) : "0s";
  const primaryUrl = urls[0]?.url ?? target.url;

  return (
    <Box flexDirection="column" paddingX={PAD} paddingY={1} gap={1} width={cardWidth + PAD * 2}>
      {/* Dekorasi KCG tetap di atas */}
      <Brand version={version} compact={compact} />

      {/* Status simpel ala contoh: Running + URL/PID/Memory/Uptime/Tunnel */}
      <Box
        width={cardWidth}
        borderStyle="round"
        borderColor="cyan"
        flexDirection="column"
        paddingX={2}
        paddingY={0}
      >
        <Box gap={1}>
          <Text color="green">●</Text>
          <Text color="green">Running</Text>
        </Box>
        <Box gap={1}>
          <Text dimColor>{"URL".padEnd(8)}</Text>
          <Text color="cyan">{primaryUrl}</Text>
        </Box>
        <Box gap={1}>
          <Text dimColor>{"Tunnel".padEnd(8)}</Text>
          <Text color={summary.color}>{summary.text}</Text>
        </Box>
        <Box gap={1}>
          <Text dimColor>{"PID".padEnd(8)}</Text>
          <Text color="white">{String(process.pid)}</Text>
        </Box>
        <Box gap={1}>
          <Text dimColor>{"Memory".padEnd(8)}</Text>
          <Text color="white">{formatMemory()}</Text>
        </Box>
        <Box gap={1}>
          <Text dimColor>{"Uptime".padEnd(8)}</Text>
          <Text color="white">{uptime}</Text>
        </Box>
        <Box gap={1}>
          <Text dimColor>{"Sessions".padEnd(8)}</Text>
          <Text color="white">
            {sessions} ({running.length} running) · {projects} projects
          </Text>
        </Box>
      </Box>

      {view.showQr && <QrCard target={target} width={cardWidth} />}
      {view.showDetail && <TunnelDetailCard info={info} width={cardWidth} />}

      {/* Menu simpel: highlight biru full-width */}
      <Box
        width={cardWidth}
        borderStyle="round"
        borderColor="blue"
        flexDirection="column"
        paddingX={1}
        paddingY={0}
      >
        {items.map((item, idx) => {
          const hint = menuHint(item.id, info, target);
          if (idx === menuIndex) {
            return (
              <Box key={item.id} backgroundColor="blue" paddingX={1}>
                <Text color="white" bold>
                  {"▶ "}
                  {item.label}
                  {"  "}
                </Text>
                <Text color="white">{hint}</Text>
              </Box>
            );
          }
          return (
            <Box key={item.id} paddingX={1}>
              <Text color="white">
                {"  "}
                {item.label}
                {"  "}
              </Text>
              <Text dimColor>{hint}</Text>
            </Box>
          );
        })}
      </Box>

      <Box justifyContent="center" paddingX={1}>
        <Text dimColor>↑/↓ navigate · Enter select · q quit</Text>
      </Box>
      <Box justifyContent="center" height={1}>
        {view.flash ? <Text color="green">✓ {view.flash}</Text> : <Text dimColor> </Text>}
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
  return renderToString(<DashboardUI info={info} version={version} view={view} />);
}

interface DashboardAppProps {
  info: DashboardInfo;
  version: string;
  onQuit: DashboardCallbacks["onQuit"];
  onOpenUrl: DashboardCallbacks["onOpenUrl"];
}

function DashboardApp({ info, version, onQuit, onOpenUrl }: DashboardAppProps) {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const startedAt = useRef(Date.now()).current;
  const [showQr, setShowQr] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [menuIndex, setMenuIndex] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const id = setInterval(tick, REFRESH_MS);
    return () => {
      clearInterval(id);
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  const notify = (msg: string) => {
    setFlash(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
  };

  const doOpen = () => {
    void onOpenUrl();
    notify("Opening in browser…");
  };
  const doCopy = () => {
    const t = bestUrl(info);
    copyToClipboard(t.url);
    notify(`Copied ${t.label} URL`);
  };
  const doQuit = () => onQuit("quit");

  const activate = (index: number) => {
    const items = menuItems({ showQr, showDetail });
    const item = items[index];
    if (!item) return;
    if (item.id === "open") doOpen();
    else if (item.id === "copy") doCopy();
    else if (item.id === "qr") setShowQr((v) => !v);
    else if (item.id === "detail") setShowDetail((v) => !v);
    else if (item.id === "quit") doQuit();
  };

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      onQuit("Ctrl+C");
      return;
    }
    if (key.escape) {
      if (showQr || showDetail) {
        setShowQr(false);
        setShowDetail(false);
        return;
      }
    }
    if (key.upArrow) {
      setMenuIndex((i) => (i + menuItems().length - 1) % menuItems().length);
      return;
    }
    if (key.downArrow) {
      setMenuIndex((i) => (i + 1) % menuItems().length);
      return;
    }
    if (key.return) {
      activate(menuIndex);
      return;
    }
    const k = input.toLowerCase();
    if (k === "q") {
      doQuit();
    } else if (k === "o") {
      doOpen();
    } else if (k === "c") {
      doCopy();
    } else if (k === "m") {
      setShowQr((v) => !v);
    } else if (k === "t") {
      setShowDetail((v) => !v);
    } else if (k === "j") {
      setMenuIndex((i) => (i + 1) % menuItems().length);
    } else if (k === "k") {
      setMenuIndex((i) => (i + menuItems().length - 1) % menuItems().length);
    } else if (/^[1-5]$/.test(k)) {
      activate(Number(k) - 1);
    }
  });

  return (
    <DashboardUI
      info={info}
      version={version}
      view={{ startedAt, showQr, showDetail, menuIndex, flash }}
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
  info: DashboardInfo & Partial<DashboardCallbacks>,
): Promise<RunningDashboard> {
  const version = await readPackageVersion();
  const stdout = process.stdout;
  const isTty = Boolean(stdout.isTTY);

  const onQuit = info.onQuit ?? (() => {});
  const onOpenUrl = info.onOpenUrl ?? (() => {});

  if (!isTty) {
    stdout.write(`${renderDashboard(info, version)}\n`);
    return {
      stop() {},
      redraw() {
        stdout.write(`${renderDashboard(info, version)}\n`);
      },
    };
  }

  const instance = render(
    <DashboardApp info={info} version={version} onQuit={onQuit} onOpenUrl={onOpenUrl} />,
    {
      alternateScreen: true,
      patchConsole: true,
      exitOnCtrlC: false,
      incrementalRendering: true,
    },
  );

  return {
    stop() {
      instance.unmount();
    },
    redraw() {
      instance.rerender(
        <DashboardApp info={info} version={version} onQuit={onQuit} onOpenUrl={onOpenUrl} />,
      );
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
