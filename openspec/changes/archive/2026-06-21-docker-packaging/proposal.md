## Why

The pi-dashboard is a multi-component system (server, bridge extension, pi agent, code-server, zrok, tmux, terminals) that requires several tools installed and configured on the host. Packaging everything into a Docker image makes deployment reproducible, portable, and self-contained — especially useful for remote servers, team environments, and CI/CD pipelines. Volume mounts allow workspace isolation and filesystem tuning for heavy I/O workloads.

## What Changes

Add a `docker/` directory with a complete containerization setup. Add a "Remote" mode to the Electron app's first-run wizard so the desktop app can connect to a Docker-hosted (or any remote) dashboard server without requiring any local installation of pi, Node.js, or other tools.

### Files

**`docker/Dockerfile`** — Multi-stage build on `node:22-bookworm-slim`:
- Stage `base`: System tools (tmux, jq, git, curl, ripgrep, fd-find, build-essential), code-server binary, zrok binary
- Stage `app`: Non-root user `pi` (UID 1000), global `@mariozechner/pi-coding-agent`, dashboard `npm install` + `npm run build`, cleanup build-essential
- Runtime: `init: true` (tini via compose), exposes 8000 + 9999, volumes for `/workspaces`, `/home/pi/.pi`, `/home/pi/.zrok2`

**`docker/entrypoint.sh`** — Startup script:
- Seeds `~/.pi/agent/auth.json` from `PI_AUTH_*` env vars on first run only (never overwrites existing)
- Starts tmux server (for tmux spawn strategy)
- Execs `pi-dashboard` with port/flag configuration from env vars

**`packages/server/src/preferences-store.ts`** (server change) — First-run pin seeder:
- On load, if `pinnedDirectories` is empty/unpersisted, seed from `PI_DASHBOARD_PIN_DIRS` (path-separator list) using the existing normalize / symlink-resolve / dedupe path
- Never seeds over a non-empty persisted list (UI edits win); mirrors `seed-auth.js`'s first-run-only guard

**`docker/scripts/seed-auth.js`** — First-run auth seeder:
- Reads env vars: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, etc.
- Writes `auth.json` with `0600` permissions
- Skips if `auth.json` already exists (volume persisted from previous run)

**`docker/compose.yml`** — Base compose:
- Single service `pi-dashboard` with build context, ports, healthcheck
- Named volumes: `pi-state` (sessions/auth/config), `zrok-state` (tunnel enrollment)
- `tmpfs` on `/tmp` for scratch I/O
- Resource limits (4 GB memory default)
- Environment-driven configuration via `.env`

**`docker/compose.dev.yml`** — Dev overlay (`docker compose -f compose.yml -f compose.dev.yml up`):
- Bind-mounts dashboard source into container for live editing
- Anonymous volume preserves container's `node_modules` (avoids platform mismatch with node-pty native addon)
- Exposes Vite HMR port 5173
- Sets `NODE_ENV=development`, runs `pi-dashboard --dev`

**`docker/up.sh`** — Workspace launcher (convenience path for multiple dirs):
- Reads `PI_WORKSPACES="/abs/a:/abs/b:/abs/c"` (path-separator list)
- Generates one `-v <dir>:<dir>` **path-identical** read-write bind per entry
- Passes the same list as `PI_DASHBOARD_PIN_DIRS` so each mounted dir is auto-pinned on first run
- Single source of truth: one list → mounted AND pinned at identical host paths

**`docker/compose.override.yml.example`** — Power-user template for workspace mounts:
- Shows **path-identical** bind mounts (host `/Users/x/Project/a` → container `/Users/x/Project/a`), not `/workspaces/<name>`
- Includes examples for read-only mounts and multiple projects
- Documents that each mount maps to a pinnable workspace at its real host path

**`docker/.env.example`** — All configurable knobs:
- API keys (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)
- Ports (DASHBOARD_PORT, PI_GATEWAY_PORT)
- Workspaces (PI_WORKSPACES: path-separator list of host dirs to mount path-identically; PI_DASHBOARD_PIN_DIRS: list to auto-pin on first run)
- External access (PI_GATEWAY_BIND: `0.0.0.0` or `127.0.0.1`)
- Tunnel (ZROK_TOKEN, TUNNEL_ENABLED)
- Spawn strategy (headless/tmux)
- Resource limits

### Electron Remote Mode

The Electron desktop app (`packages/electron/`) gains a third wizard mode alongside "standalone" and "power user":

**`packages/electron/src/lib/wizard-state.ts`** — Extended `ModeConfig`:
- Add `"remote"` to the mode union type
- Add optional `remoteUrl` field (e.g. `http://docker-host:8000`)

**`packages/electron/src/lib/server-lifecycle.ts`** — Modified `ensureServer()`:
- When mode is `"remote"`, return `remoteUrl` directly — skip mDNS discovery, health check fallback, and local server spawning entirely
- `didWeStartServer()` always returns `false` in remote mode (never stop remote server on quit)

**Wizard renderer** — Third radio option in the mode selection step:
- "Remote" option with a URL input field and "Test Connection" button
- Test calls `GET <url>/api/health` and shows success/failure
- On success, saves `{ mode: "remote", remoteUrl: "..." }` to `mode.json`

No changes needed to the web client — it already supports remote servers via `ServerSelector`, dynamic WebSocket URL construction, and `ApiContext` that derives all REST API URLs from the connection URL.

### Volume Performance Profiles

The `compose.yml` includes commented volume configurations for three profiles:

1. **Default** — Named Docker volume, uses host filesystem. Works everywhere, good for moderate usage.
2. **Performance** — Dedicated ext4/xfs partition with `noatime,data=writeback,barrier=0,commit=60`. For many concurrent sessions with heavy JSONL writes. Linux only.
3. **Ephemeral** — tmpfs-backed (`size=2g`). Maximum speed, data lost on restart. For CI/CD and throwaway experiments.

### Pi Gateway External Access

Port 9999 (pi gateway) is exposed by default so external pi sessions can connect. Two layers of control:
- **Compose `ports`**: Remove or empty `PI_GATEWAY_PORT` to stop publishing
- **Server bind address**: `PI_GATEWAY_BIND=127.0.0.1` makes the server reject non-local connections even if the port is published

### API Key Provisioning

Both paths are first-class:
1. **Pre-configured**: Set keys in `.env` file → `entrypoint.sh` seeds `auth.json` on first run → persisted in `pi-state` volume
2. **Browser UI**: Start container without keys → open dashboard → Settings → Provider Auth → OAuth or paste keys → saved to `auth.json` in volume

### Architecture Constraint: Single Container

The dashboard's components are inherently colocated — pi sessions, terminals (node-pty), code-server, and the server all need shared filesystem access and localhost communication. A multi-container split would fight the architecture (tmux can't spawn in another container, code-server needs the workspace filesystem, pi gateway is localhost). One container with multiple processes managed by the dashboard server is the correct design.

### Base Image: Debian, Not Alpine

`node-pty` requires glibc for proper PTY support. Alpine uses musl which causes subtle terminal emulation issues. `node:22-bookworm-slim` provides glibc with minimal image size.

## Capabilities

### New Capabilities

- `docker-packaging`: Complete Docker containerization of the pi-dashboard ecosystem with all tools (pi, code-server, zrok, tmux, jq, git, bash, ripgrep), configurable volumes with I/O performance profiles, dual API key provisioning, optional external pi gateway access, path-identical multi-directory workspace mounts driven by a single `PI_WORKSPACES` list, and first-run pin seeding via `PI_DASHBOARD_PIN_DIRS`.

### Existing Capabilities Modified

- `electron-shell`: Add "Remote" mode to first-run wizard and `ensureServer()` flow. In remote mode, Electron connects directly to a configured URL (Docker container or any remote server) without local server discovery or spawning. ~50 lines of logic across 2-3 files.
