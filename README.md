# kcgcode

Control your [OpenCode](https://opencode.ai) agents from your phone. kcgcode runs a local bridge
on your machine and serves a mobile-friendly web app (PWA) where you chat with agents, answer
their permission prompts, manage projects and skills, and keep it all behind a lock screen when
you reach it through a tunnel.

> Only OpenCode is supported as an agent right now. Claude Code support is planned.

## Features

- **Chat with agents from anywhere.** Start sessions per project, stream replies live, stop a
  running turn, and pick the model and agent mode (build, plan, or your own agents).
- **Answer prompts on the go.** Permission requests and multi-question prompts from the agent
  show up as cards you can approve, deny, or answer from your phone.
- **Projects & sessions.** Organise work by folder inside a sandbox. The sidebar groups every
  session by project, with live status and a quick search (`Ctrl/⌘ + K`).
- **Rich input.** Mention files with `@`, attach images, and set per-project custom
  instructions.
- **Skills from [skills.sh](https://skills.sh).** Search the directory, see security audit
  results before you install, and add skills to a project in one click. Installs run in the
  background with live output, survive page refreshes, and can be cancelled. The agent picks up
  new skills automatically, waiting for any running chat to finish first.
- **App lock.** Protect the app with a PIN or password before exposing it. It comes with a lock
  screen showing your profile photo or avatar, auto-lock after inactivity, signed-in device
  management, and brute-force protection.
- **Installable PWA** with light, dark, or system theme.
- **Terminal dashboard.** `kcgcode` shows the server status right in your terminal.

## Requirements

- [Bun](https://bun.com) 1.1 or newer
- [OpenCode](https://opencode.ai) installed and on your `PATH` (kcgcode starts `opencode serve`
  for each project)
- Internet access for skills.sh search and skill installs (installs use `bunx skills`)

## Install

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
# create ~/.kcgcode (config, sandbox, data)
kcgcode init

# start the server + terminal dashboard (works from any directory)
kcgcode

# custom port, open the browser
kcgcode start --port 4000 --open
```

Open the printed URL in your browser. Projects are folders inside the sandbox root from your
config.

## Using it from your phone

By default the server only listens on `127.0.0.1`, so it's reachable from this machine only.
To use it from your phone:

1. **Set a lock first.** Open **Settings → Security** and turn on the app lock (PIN or
   password). Until a lock is set, anyone who can reach the address can control your agents and
   run commands on your machine. The sidebar shows a "Not protected" warning while there's no
   lock.
2. **Expose it.** Either:
   - Turn on **Settings → Remote access** (built in, see below), or
   - Use an HTTPS tunnel such as Cloudflare Tunnel or ngrok, pointed at the kcgcode port, or
   - Bind to your LAN with `kcgcode --host 0.0.0.0` and open `http://<your-ip>:3000` on the
     same network. Traffic isn't encrypted on plain HTTP, so prefer a tunnel.
3. Open the URL on your phone, unlock, and optionally add it to your home screen.

Only tunnel the kcgcode port. The per-project `opencode serve` processes have no password of
their own and should stay local.

### Remote access (`https://<name>.<your-domain>`)

kcgcode can publish itself at your own subdomain through a kcgcode tunnel server you host
(see [`reverse-proxy/`](reverse-proxy)).

1. Set an app lock. Remote access can't be turned on without one, and removing the lock turns
   it off.
2. **Settings → Remote access → Connect.** kcgcode shows a code, a link, and a QR code.
3. Open the link on any device (your phone works), sign in with Google, check that the code
   matches, and approve. First time only: pick a name (3–20 lowercase letters, numbers, or
   hyphens).
4. kcgcode connects and turns the tunnel on. It downloads `frpc` v0.71.0 to `~/.kcgcode/bin`
   (SHA-256 verified; an existing `frpc` on `PATH` is used instead). The tunnel reconnects on its
   own and comes back after a restart.

Google sign-in happens entirely on the tunnel service, so kcgcode never holds Google
credentials. What it stores is a device token (revocable, per machine) and the tunnel secret, in
SQLite plus `frpc.toml` (mode 0600) next to it. Neither is ever sent to the browser.
Under **Advanced**, **Unlink this computer** revokes the device token on the server and
**Reset security key** issues a new frp secret if you think it leaked.

The tunnel server URL is baked into the published npm package, so users don't configure
anything. `KCG_TUNNEL_API_URL` overrides it, for example to point at your own server.

| Environment variable | Default |
| --- | --- |
| `KCG_TUNNEL_API_URL` | The URL built into the package (none in a git checkout) |
| `KCG_FRPC_PATH` | auto (`~/.kcgcode/bin/frpc`, then `PATH`, then download) |

## Security

When a lock is set:

- Every API route and the WebSocket require a signed-in session. The only exceptions are the
  lock screen's status, login, and profile photo.
- The PIN or password is stored as an argon2id hash. Sessions use an `HttpOnly`,
  `SameSite=Strict` cookie, marked `Secure` over HTTPS. The database only stores a hash of the
  session token.
- Requests from other sites are rejected (Origin check, including the WebSocket).
- Auto-lock (5 min to 1 hour, or never) is enforced by the server, not just the UI. Locking,
  changing the lock, or signing out a device also closes that device's live connection.
- Failed attempts are rate limited per IP and globally, since tunnels can hide the real IP.
  Repeated failures pause all logins for up to 15 minutes.
- PINs must be 6–12 digits, and trivial patterns like `111111` or `123456` are rejected.
  Passwords need at least 8 characters.

**Forgot your PIN or password?** Run this on the host machine:

```bash
kcgcode reset-lock
```

It removes the lock and signs out every device, but keeps your profile. Set a new lock right
away if the app is exposed.

Skills run with your agent's full permissions. Review a skill and its audit before installing.

## CLI

| Command | Description |
| --- | --- |
| `kcgcode` / `kcgcode start` | Run the server + live dashboard |
| `kcgcode init` | Create `~/.kcgcode` (config, sandbox, data) |
| `kcgcode reset-lock` | Remove the app lock and sign out all devices |
| `kcgcode --help` | Show help |
| `kcgcode --version` | Show version |

| Option | Description |
| --- | --- |
| `-p, --port <n>` | HTTP port (default `3000`, env `KCG_PORT`) |
| `-H, --host <h>` | Bind host (default `127.0.0.1`, env `KCG_HOST`) |
| `-c, --config <f>` | Config path (default `~/.kcgcode/config.json`) |
| `--open` | Open the web app in your browser |

Dashboard keys: `q` quit · `o` open browser · `Ctrl+C` stop.

| Environment variable | Description |
| --- | --- |
| `KCG_PORT` | HTTP port |
| `KCG_HOST` | Bind host |
| `KCG_CONFIG_PATH` | Config file path |
| `KCG_DB_PATH` | SQLite path (default `~/.kcgcode/data/kcg-code.sqlite`) |

## Config & data location

The runtime mode is detected from the entrypoint:

| | **dev** (`bun dev` / `src/index.ts`) | **cli** (`kcgcode` global binary) |
| --- | --- | --- |
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
    kcg-code.sqlite        # projects, sessions, messages, app lock
    uploads/               # image attachments
```

Config file resolution order:

1. `--config <path>` / `KCG_CONFIG_PATH` (always wins)
2. **cli**: `~/.kcgcode/config.json` (cwd is ignored)
3. **dev**: `./kcg-code.config.json` if present, else `~/.kcgcode/config.json`

```json
{
  "sandboxRoot": "/absolute/path/to/your/workspace"
}
```

Skills installed from the Skills page go into the project folder under `.agents/skills/`.

## Develop

Copy `.env.example` to `.env`. Bun loads it automatically, and it's gitignored. Set
`KCG_TUNNEL_API_URL` to your tunnel server to use Remote access while developing.

```bash
bun install
bun dev             # dev server with HMR (uses ./kcg-code.config.json if present)
bun test
bun run lint
bun run typecheck
bun run build
```

### Publishing

`bun publish` (or `bun pm pack`) runs `prepack`, which writes `KCG_TUNNEL_API_URL` from `.env`
into `src/build-config.ts`. `postpack` then resets it, so the URL never ends up in git.
Publishing fails if the variable is missing or isn't `https://`. Check what gets published with:

```bash
bun pm pack && tar -xOzf kcgcode-*.tgz package/src/build-config.ts
```

Built with [Bun](https://bun.com).
