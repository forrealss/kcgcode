/**
 * Parser argumen CLI kcgcode (tanpa dependency eksternal).
 */

export interface CliArgs {
  command: "start" | "init" | "help" | "version" | "invalid";
  port?: number;
  host?: string;
  /** Path berkas konfigurasi (override KCG_CONFIG_PATH). */
  config?: string;
  open: boolean;
  /** Argumen tak dikenal / pesan error. */
  error?: string;
}

const HELP_TEXT = `kcgcode — control CLI AI agents from your phone

USAGE
  kcgcode [start] [options]
  kcgcode init [options]
  kcgcode help | --help | -h
  kcgcode version | --version | -v

COMMANDS
  start (default)   Run server + terminal dashboard
  init              Create kcg-code.config.json & local sandbox folder

OPTIONS
  -p, --port <n>    HTTP port (default 3000 / env KCG_PORT)
  -H, --host <h>    Bind host (default 127.0.0.1 / env KCG_HOST)
  -c, --config <f>  Config path (default ~/.kcgcode/config.json)
  --open            Open the web dashboard in a browser after start
  -h, --help        Show help
  -v, --version     Show version

ENV
  KCG_PORT              HTTP port
  KCG_HOST              Bind host
  KCG_CONFIG_PATH       Config file path
  KCG_AUTH_ENABLED      "true" to require bearer token
  KCG_AUTH_TOKEN        Auth token
  KCG_DB_PATH           SQLite path (default ~/.kcgcode/data/kcg-code.sqlite)

EXAMPLES
  kcgcode
  kcgcode init
  kcgcode start --port 4000 --open
  kcgcode init --config ~/.kcgcode/config.json
`;

export function helpText(): string {
  return HELP_TEXT;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { command: "start", open: false };
  const rest = [...argv];

  // Command eksplisit di posisi pertama (bukan flag)
  const first = rest[0];
  if (first === "init") {
    args.command = "init";
    rest.shift();
  } else if (first === "start") {
    args.command = "start";
    rest.shift();
  } else if (first === "help") {
    args.command = "help";
    rest.shift();
  } else if (first === "version") {
    args.command = "version";
    rest.shift();
  }

  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === undefined) continue;

    if (a === "-h" || a === "--help") {
      return { command: "help", open: false };
    }
    if (a === "-v" || a === "--version") {
      return { command: "version", open: false };
    }
    if (a === "--open") {
      args.open = true;
      continue;
    }
    if (a === "-p" || a === "--port") {
      const raw = rest[++i];
      if (raw === undefined)
        return { ...args, command: "invalid", error: `Missing value for ${a}` };
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0 || n > 65535) {
        return { ...args, command: "invalid", error: `Invalid port "${raw}"` };
      }
      args.port = n;
      continue;
    }
    if (a === "-H" || a === "--host") {
      const raw = rest[++i];
      if (raw === undefined)
        return { ...args, command: "invalid", error: `Missing value for ${a}` };
      args.host = raw;
      continue;
    }
    if (a === "-c" || a === "--config") {
      const raw = rest[++i];
      if (raw === undefined)
        return { ...args, command: "invalid", error: `Missing value for ${a}` };
      args.config = raw;
      continue;
    }
    if (a.startsWith("-")) {
      return { ...args, command: "invalid", error: `Unknown option "${a}"` };
    }
    return { ...args, command: "invalid", error: `Unknown command "${a}"` };
  }

  return args;
}
