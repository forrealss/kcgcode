# kcgcode

Control CLI AI agents (OpenCode / Claude Code) from your phone — local headless bridge + mobile PWA.

## Install (global)

```bash
bun i -g kcgcode
```

Or from a local clone:

```bash
bun pm pack
bun i -g ./kcgcode-0.1.0.tgz
```

## Quick start

```bash
# scaffold ~/.kcgcode (config + sandbox + data)
kcgcode init

# start server + modern terminal dashboard (works from any directory)
kcgcode

# custom port, open browser
kcgcode start --port 4000 --open
```

Open the printed URL on your phone (same LAN) or desktop.

## CLI

| Command | Description |
| --- | --- |
| `kcgcode` / `kcgcode start` | Run server + live dashboard |
| `kcgcode init` | Create `~/.kcgcode` (config, sandbox, data) |
| `kcgcode --help` | Show help |
| `kcgcode --version` | Show version |

| Option | Description |
| --- | --- |
| `-p, --port <n>` | HTTP port (default `3000`, env `KCG_PORT`) |
| `-H, --host <h>` | Bind host (default `127.0.0.1`, env `KCG_HOST`) |
| `-c, --config <f>` | Config path (default `~/.kcgcode/config.json`) |
| `--open` | Open the web dashboard in your browser |

Dashboard keys: `q` quit · `o` open browser · `Ctrl+C` stop.

## Config & data location

Runtime mode is detected from the entrypoint:

| | **dev** (`bun dev` / `src/index.ts`) | **cli** (`kcgcode` global binary) |
| --- | --- | --- |
| Mode flag | `setRunMode("dev")` | `setRunMode("cli")` in `bin/kcgcode.ts` |
| Config | `./kcg-code.config.json` if present, else `~/.kcgcode/config.json` | `~/.kcgcode/config.json` |
| SQLite | `./data/kcg-code.sqlite` | `~/.kcgcode/data/kcg-code.sqlite` |
| Uploads | `./data/uploads` | `~/.kcgcode/data/uploads` |
| Sandbox (init) | `./sandbox` | `~/.kcgcode/sandbox` |
| HMR | on | off (`NODE_ENV=production`) |

Global CLI layout:

```
~/.kcgcode/
  config.json              # sandboxRoot
  sandbox/                 # default agent workspace
  data/
    kcg-code.sqlite
    uploads/
```

Resolution order for the config file:

1. `--config <path>` / `KCG_CONFIG_PATH` (always wins)
2. **cli**: `~/.kcgcode/config.json` (cwd is ignored)
3. **dev**: `./kcg-code.config.json` if present, else `~/.kcgcode/config.json`

```json
{
  "sandboxRoot": "/absolute/path/to/your/workspace"
}
```

Override the database with `KCG_DB_PATH` if needed.

## Develop

```bash
bun install
bun dev          # dev server with HMR (uses ./kcg-code.config.json if present)
bun test
bun run lint
bun run typecheck
```

Built with [Bun](https://bun.com).
