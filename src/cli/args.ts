/**
 * Parser argumen CLI kcgcode (tanpa dependency eksternal).
 */

import { c } from "./theme";

export interface CliArgs {
  command:
    | "start"
    | "stop"
    | "status"
    | "logs"
    | "init"
    | "reset-lock"
    | "help"
    | "version"
    | "invalid";
  port?: number;
  host?: string;
  /** Path berkas konfigurasi (override KCG_CONFIG_PATH). */
  config?: string;
  open: boolean;
  /** Izinkan OS sleep (matikan keep-awake). */
  allowSleep?: boolean;
  /** Jalankan di background (lepas dari terminal). */
  detach?: boolean;
  /** `logs`: ikuti log baru. */
  follow?: boolean;
  /** `logs`: jumlah baris terakhir. */
  lines?: number;
  /** Argumen tak dikenal / pesan error. */
  error?: string;
}

const HELP_TEXT = `kcgcode — control CLI AI agents from your phone

USAGE
  kcgcode [start] [options]
  kcgcode start -d [options]
  kcgcode stop | status | logs [-f]
  kcgcode init [options]
  kcgcode help | --help | -h
  kcgcode version | --version | -v

COMMANDS
  start (default)   Run server + terminal dashboard; if it already runs
                    in background, open its dashboard instead
  stop              Stop the background server
  status            Show background server status
  logs              Show background server log (-f to follow)
  init              Create kcg-code.config.json & local sandbox folder
  reset-lock        Remove the app lock (forgot PIN/password) & sign out all devices

OPTIONS
  -p, --port <n>    HTTP port (default: config "port" or 3000; a busy
                    default is swapped for the next free port)
  -H, --host <h>    Bind host (default 127.0.0.1 / env KCG_HOST)
  -c, --config <f>  Config path (default ~/.kcgcode/config.json)
  -d, --detach      Run in background (keeps running after terminal closes)
  --open            Open the web dashboard in a browser after start
  -f, --follow      logs: keep printing new lines
  -n, --lines <n>   logs: number of lines to show (default 50)
  --allow-sleep     Let the OS sleep while running (default: keep awake)
  -h, --help        Show help
  -v, --version     Show version

ENV
  KCG_PORT              HTTP port
  KCG_HOST              Bind host
  KCG_CONFIG_PATH       Config file path
  KCG_DB_PATH           SQLite path (default ~/.kcgcode/data/kcg-code.sqlite)
  KCG_ALLOW_SLEEP=1     Same as --allow-sleep
  KCG_NO_UPDATE_CHECK   Set to 1 to skip the npm update check

EXAMPLES
  kcgcode
  kcgcode init
  kcgcode start --port 4000 --open
  kcgcode start -d && kcgcode logs -f
  kcgcode init --config ~/.kcgcode/config.json
`;

/** Help berwarna: heading cyan, flag/command hijau, deskripsi redup. */
export function helpText(): string {
  return HELP_TEXT.split("\n")
    .map((line, i) => {
      if (i === 0) return c.cyanBright(line);
      if (/^[A-Z]+$/.test(line)) return c.cyanBright(line);
      const m = line.match(/^(\s{2})(\S.*?)(\s{2,})(\S.*)$/);
      if (m) return `${m[1]}${c.green(m[2] as string)}${m[3]}${c.dim(m[4] as string)}`;
      if (/^\s+kcgcode/.test(line)) return c.white(line);
      return line;
    })
    .join("\n");
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { command: "start", open: false };
  const rest = [...argv];

  // Command eksplisit di posisi pertama (bukan flag)
  const first = rest[0];
  if (first === "init") {
    args.command = "init";
    rest.shift();
  } else if (first === "reset-lock") {
    args.command = "reset-lock";
    rest.shift();
  } else if (first === "start" || first === "stop" || first === "status" || first === "logs") {
    args.command = first;
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
    if (a === "-d" || a === "--detach") {
      args.detach = true;
      continue;
    }
    if (a === "-f" || a === "--follow") {
      args.follow = true;
      continue;
    }
    if (a === "-n" || a === "--lines") {
      const raw = rest[++i];
      const n = Number(raw);
      if (raw === undefined || !Number.isInteger(n) || n <= 0) {
        return { ...args, command: "invalid", error: `Invalid value for ${a}` };
      }
      args.lines = n;
      continue;
    }
    if (a === "--allow-sleep") {
      args.allowSleep = true;
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
