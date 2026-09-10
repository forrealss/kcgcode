/**
 * Dashboard terminal live untuk server kcgcode.
 *
 * Alternate screen buffer + redraw periodik — tanpa dependency TUI berat.
 * Info: URL, sandbox, auth, stats projects/sessions.
 */

import { networkInterfaces } from "node:os";
import { isCliMode } from "../runtime";
import type { KcgServer } from "../server/app";
import type { AuthConfig } from "../server/middleware/auth.middleware";
import {
  c,
  link,
  logoLines,
  panel,
  readPackageVersion,
  row,
  statusDot,
  symbols,
  terminalWidth,
} from "./theme";

export interface DashboardInfo {
  server: KcgServer;
  auth: AuthConfig;
  port: number;
  hostname: string;
  sandboxRoot: string;
  configPath: string;
  dbPath: string;
}

const REFRESH_MS = 2000;

function localUrls(hostname: string, port: number): { label: string; url: string }[] {
  const urls: { label: string; url: string }[] = [];
  const host = hostname === "0.0.0.0" || hostname === "::" ? "localhost" : hostname;
  urls.push({ label: "Local", url: `http://${host}:${port}` });

  if (hostname === "127.0.0.1" || hostname === "localhost") {
    return urls;
  }

  for (const infos of Object.values(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === "IPv4" && !info.internal) {
        urls.push({ label: "Network", url: `http://${info.address}:${port}` });
      }
    }
  }
  return urls;
}

function statsBlock(app: KcgServer): string[] {
  const projects = app.store.listProjects();
  const sessions = app.store.listSessions();
  const running = sessions.filter((s) => s.status === "running").length;
  const lines: string[] = [];
  lines.push(`${row("Projects", c.bold(String(projects.length)))}`);
  lines.push(`${row("Sessions", c.bold(String(sessions.length)))}`);
  lines.push(`${row("Running", running > 0 ? c.greenBright(String(running)) : c.dim("0"))}`);
  if (running > 0) {
    const active = sessions.filter((s) => s.status === "running").slice(0, 3);
    for (const s of active) {
      const title = s.title?.trim() || s.id.slice(0, 12);
      lines.push(`${c.dim("  ·")} ${c.cyan(title)}`);
    }
  }
  return lines;
}

function headerBlock(version: string): string {
  const logos = logoLines();
  const marks = [
    `${c.bold(c.white("KCG"))} ${c.cyanBright("CODE")}`,
    c.dim(`v${version}  ·  mobile control for CLI agents`),
    c.gray("opencode · claude code"),
  ];
  const out: string[] = [];
  const rows = Math.max(logos.length, marks.length + 2);
  for (let i = 0; i < rows; i++) {
    const left = (logos[i] ?? "").padEnd(18);
    const right = marks[i] ?? "";
    out.push(`  ${left}  ${right}`);
  }
  return out.join("\n");
}

export function renderDashboard(info: DashboardInfo, version: string): string {
  const width = Math.min(Math.max(terminalWidth(), 56), 80);
  const { server, auth, port, hostname, sandboxRoot, configPath, dbPath } = info;
  const urls = localUrls(hostname, port);

  const serverLines = urls.map((u, idx) => {
    const dot = idx === 0 ? statusDot(true) : c.violetBright(symbols.idle);
    return `${dot}  ${c.dim(u.label.padEnd(8))}${link(u.url)}`;
  });
  serverLines.push("");
  serverLines.push(row("Process", c.greenBright("running")));

  const configLines = [
    row("Sandbox", c.white(sandboxRoot)),
    row("Config", c.dim(configPath)),
    row("Database", c.dim(dbPath)),
    row("Mode", c.dim(isCliMode() ? "cli · ~/.kcgcode" : "dev · local")),
    row("Bind", `${c.white(hostname)}:${c.white(String(port))}`),
    row("Auth", auth.authEnabled ? c.yellowBright(`enabled · token required`) : c.dim("disabled")),
    row("Bun", c.dim(Bun.version)),
  ];

  const actLines = statsBlock(server);

  const parts = [
    headerBlock(version),
    "",
    panel("SERVER", serverLines, width),
    "",
    panel("CONFIG", configLines, width),
    "",
    panel("ACTIVITY", actLines, width),
    "",
    `  ${c.dim("q")} quit   ${c.dim("Ctrl+C")} stop   ${c.dim("o")} open browser   ${c.dim("refresh")} ${c.dim("every 2s")}`,
  ];
  return parts.join("\n");
}

export interface RunningDashboard {
  stop(): void;
  /** Ganti frame sekarang (dipanggil setelah event penting). */
  redraw(): void;
}

/**
 * Mulai loop dashboard di alternate screen. Kembalikan handle untuk stop.
 * Pastikan `stop()` dipanggil saat shutdown agar terminal pulih.
 */
export async function startDashboard(info: DashboardInfo): Promise<RunningDashboard> {
  const version = await readPackageVersion();
  const stdout = process.stdout;
  const isTty = Boolean(stdout.isTTY);

  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const draw = () => {
    if (stopped) return;
    const frame = renderDashboard(info, version);
    if (isTty) {
      // Home + clear down, lalu tulis frame (tanpa alt-screen agar log
      // error tetap terlihat di scrollback setelah quit).
      stdout.write(`\x1b[H\x1b[2J${frame}\n`);
    } else {
      stdout.write(`${frame}\n`);
    }
  };

  if (isTty) {
    stdout.write("\x1b[?25l"); // hide cursor
  }
  draw();
  if (isTty && REFRESH_MS > 0) {
    timer = setInterval(draw, REFRESH_MS);
  }

  const restore = () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearInterval(timer);
    if (isTty) {
      stdout.write("\x1b[?25h"); // show cursor
    }
  };

  // Tangani resize terminal
  const onResize = () => draw();
  if (isTty) stdout.on("resize", onResize);

  return {
    stop() {
      restore();
      if (isTty) stdout.off("resize", onResize);
    },
    redraw: draw,
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
