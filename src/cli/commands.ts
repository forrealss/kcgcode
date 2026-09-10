/**
 * Perintah CLI: start (server + dashboard) dan init (scaffold config).
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveConfig } from "../config";
import spa from "../index.html";
import {
  defaultSandboxDir,
  ensureKcgHome,
  KCG_HOME,
  resolveEffectiveConfigPath,
  resolveEffectiveDbPath,
  resolveEffectiveUploadsDir,
} from "../paths";
import { isCliMode } from "../runtime";
import { createKcgServer } from "../server/app";
import { loadAuthConfig } from "../server/middleware/auth.middleware";
import type { CliArgs } from "./args";
import { openBrowser, startDashboard } from "./dashboard";
import { c, panel, row, symbols } from "./theme";

const SPA_PATHS = ["/", "/projects", "/projects/*"];

function applyEnvOverrides(args: CliArgs): void {
  if (args.port !== undefined) process.env.KCG_PORT = String(args.port);
  if (args.host !== undefined) process.env.KCG_HOST = args.host;
  if (args.config !== undefined) process.env.KCG_CONFIG_PATH = args.config;
}

function failConfig(message: string): never {
  console.error(`${c.redBright(symbols.cross)} ${message}`);
  console.error(
    `\n${c.dim("Run")} ${c.cyan("kcgcode init")} ${c.dim("to create")} ${c.cyan("~/.kcgcode/config.json")}${c.dim(".")}`,
  );
  process.exit(1);
}

export async function runStart(args: CliArgs): Promise<void> {
  // CLI global = mode produksi: matikan HMR dev yang noisy di luar repo.
  if (process.env.NODE_ENV === undefined) {
    process.env.NODE_ENV = "production";
  }
  applyEnvOverrides(args);

  const cfg = resolveConfig();
  if (!cfg.ok) failConfig(cfg.error);

  const auth = loadAuthConfig();
  const port = args.port ?? Number(process.env.KCG_PORT ?? 3000);
  const hostname = args.host ?? auth.hostname;
  const dbPath = resolveEffectiveDbPath();

  const app = createKcgServer({
    config: cfg.data,
    auth,
    spa,
    spaPaths: SPA_PATHS,
    port,
    hostname,
    uploadsRoot: resolveEffectiveUploadsDir(),
  });

  const resolvedPort = app.server.port ?? port;
  const configPath = cfg.data.configPath;
  const dash = await startDashboard({
    server: app,
    auth,
    port: resolvedPort,
    hostname,
    sandboxRoot: cfg.data.sandboxRoot,
    configPath,
    dbPath: path.resolve(dbPath),
  });

  const primaryUrl = `http://${hostname === "0.0.0.0" || hostname === "::" ? "localhost" : hostname}:${resolvedPort}`;

  if (args.open) {
    void openBrowser(primaryUrl);
  }

  // Keyboard: q = quit (TTY saja)
  const stdin = process.stdin;
  const isInteractive = Boolean(stdin.isTTY);
  const onKey = (chunk: Buffer | string) => {
    const s = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    if (s === "q" || s === "Q" || s === "\x03") {
      void shutdown("quit");
    }
    if (s === "o" || s === "O") {
      void openBrowser(primaryUrl);
    }
  };

  let shuttingDown = false;
  async function shutdown(reason: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    if (isInteractive) {
      stdin.off("data", onKey);
      stdin.setRawMode(false);
      stdin.pause();
    }
    dash.stop();
    console.log(`\n${c.dim(`(${reason})`)} ${c.yellow("Saving session state and stopping…")}`);
    try {
      await app.close();
    } catch (err) {
      console.error(c.red("Shutdown error:"), err);
    }
    console.log(c.greenBright(`${symbols.check} KCG Code stopped.`));
    process.exit(0);
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  if (isInteractive) {
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onKey);
  }
}

export function runInit(args: CliArgs): void {
  if (isCliMode()) ensureKcgHome();

  const configPath = resolveEffectiveConfigPath(args.config);
  const sandboxPath = args.config
    ? path.join(path.dirname(configPath), "sandbox")
    : defaultSandboxDir();
  const dataDir = path.dirname(resolveEffectiveDbPath());

  if (existsSync(configPath)) {
    console.log(
      panel("INIT", [
        row("Config", c.yellow("already exists — skipped")),
        row("Path", c.dim(configPath)),
        row("Mode", c.dim(isCliMode() ? "cli (~/.kcgcode)" : "dev (local)")),
        row("Home", c.dim(KCG_HOME)),
        "",
        c.dim("Edit sandboxRoot in the config if needed."),
      ]),
    );
    return;
  }

  mkdirSync(path.dirname(configPath), { recursive: true });
  mkdirSync(sandboxPath, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  const body = `${JSON.stringify({ sandboxRoot: sandboxPath }, null, 2)}\n`;
  writeFileSync(configPath, body, "utf8");

  console.log(
    panel("INIT", [
      row("Config", c.greenBright(`${symbols.check} created`)),
      row("Path", c.white(configPath)),
      row("Sandbox", c.white(sandboxPath)),
      row("Data", c.dim(dataDir)),
      row("Mode", c.dim(isCliMode() ? "cli (~/.kcgcode)" : "dev (local)")),
      "",
      c.dim(
        isCliMode()
          ? `Run ${c.cyan("kcgcode")} to start the dashboard.`
          : `Run ${c.cyan("bun dev")} in the project, or ${c.cyan("kcgcode")} if installed globally.`,
      ),
    ]),
  );
}
