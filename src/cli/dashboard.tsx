/**
 * Dashboard terminal live untuk server kcgcode — dirender lewat Ink.
 *
 * Alternate screen + frame update in-place; layout modern dengan card.
 */
import { networkInterfaces } from "node:os";
import { Box, render, renderToString, Text, useInput } from "ink";
import { type ReactNode, useEffect, useReducer } from "react";
import type { KcgServer } from "../server/app";
import { logoLines, readPackageVersion } from "./theme";

export interface DashboardInfo {
  server: KcgServer;
  port: number;
  hostname: string;
}

export interface DashboardCallbacks {
  /** Panggil saat user minta berhenti (q / Ctrl+C). */
  onQuit: (reason: string) => void;
  /** Buka URL dashboard di browser default. */
  onOpenUrl: () => void | Promise<void>;
}

const REFRESH_MS = 2000;
const PAD = 2;

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

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1} gap={0}>
      <Text color="cyan" bold>
        {title}
      </Text>
      <Box flexDirection="column" gap={0}>
        {children}
      </Box>
    </Box>
  );
}

function Key({ children }: { children: string }) {
  return <Text dimColor>{children}</Text>;
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <Box gap={1}>
      <Text dimColor>{label.padEnd(10)}</Text>
      <Text bold color={accent ? "green" : undefined}>
        {value}
      </Text>
    </Box>
  );
}

function Brand({ version }: { version: string }) {
  const logos = logoLines();
  return (
    <Box gap={2}>
      <Box flexDirection="column">
        {logos.map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static logo lines
          <Text key={i} color="cyan" bold>
            {line}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column">
        <Box gap={1}>
          <Text bold color="cyan">
            kcgcode
          </Text>
          <Text dimColor>v{version}</Text>
        </Box>
        <Text dimColor>mobile control for CLI agents</Text>
        <Text dimColor>opencode · claude code</Text>
      </Box>
    </Box>
  );
}

interface DashboardUIProps {
  info: DashboardInfo;
  version: string;
}

function DashboardUI({ info, version }: DashboardUIProps) {
  const { server, port, hostname } = info;
  const urls = localUrls(hostname, port);
  const { projects, sessions, running } = activityStats(server);

  return (
    <Box flexDirection="column" paddingX={PAD} paddingY={1} gap={1}>
      <Brand version={version} />

      <Card title="SERVER">
        {urls.map((u, idx) => (
          <Box key={u.url} gap={1}>
            <Text color={idx === 0 ? "green" : "gray"}>{idx === 0 ? "●" : "○"}</Text>
            <Text dimColor>{u.label.padEnd(8)}</Text>
            <Text color="cyan" underline>
              {u.url}
            </Text>
          </Box>
        ))}
        <Box marginTop={0} gap={1}>
          <Text dimColor>{"process".padEnd(8)}</Text>
          <Text color="green" bold>
            running
          </Text>
        </Box>
      </Card>

      <Card title="ACTIVITY">
        <Metric label="projects" value={String(projects)} />
        <Metric label="sessions" value={String(sessions)} />
        <Metric label="running" value={String(running.length)} accent={running.length > 0} />

        {running.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            {running.slice(0, 5).map((s) => (
              <Box key={s.id} gap={1}>
                <Text color="green">●</Text>
                <Text>{s.title?.trim() || s.id.slice(0, 12)}</Text>
              </Box>
            ))}
          </Box>
        )}
      </Card>

      <Box gap={2}>
        <Box gap={1}>
          <Key>q</Key>
          <Text dimColor>quit</Text>
        </Box>
        <Box gap={1}>
          <Key>o</Key>
          <Text dimColor>open</Text>
        </Box>
        <Box gap={1}>
          <Key>ctrl+c</Key>
          <Text dimColor>stop</Text>
        </Box>
      </Box>
    </Box>
  );
}

/** Frame string (non-TTY / test). */
export function renderDashboard(info: DashboardInfo, version: string): string {
  return renderToString(<DashboardUI info={info} version={version} />);
}

interface DashboardAppProps {
  info: DashboardInfo;
  version: string;
  onQuit: DashboardCallbacks["onQuit"];
  onOpenUrl: DashboardCallbacks["onOpenUrl"];
}

function DashboardApp({ info, version, onQuit, onOpenUrl }: DashboardAppProps) {
  const [, tick] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const id = setInterval(tick, REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      onQuit("Ctrl+C");
      return;
    }
    if (input === "q" || input === "Q") {
      onQuit("quit");
      return;
    }
    if (input === "o" || input === "O") {
      void onOpenUrl();
    }
  });

  return <DashboardUI info={info} version={version} />;
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
