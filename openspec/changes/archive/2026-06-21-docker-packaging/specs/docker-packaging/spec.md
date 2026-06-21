## ADDED Requirements

### Requirement: Dockerfile builds a self-contained image
The Dockerfile SHALL produce a single image containing Node.js 22 LTS, pi coding agent, pi-dashboard (with built client), code-server, zrok, tmux, jq, git, curl, ripgrep, fd-find, and bash. The image SHALL use `node:22-bookworm-slim` as the base. The image SHALL create a non-root user `pi` (UID 1000) and run all processes as that user. Build-essential and python3 SHALL be removed after native addon compilation to reduce image size.

#### Scenario: Image contains all required tools
- **WHEN** the image is built with `docker compose build`
- **THEN** the following binaries are available on PATH: `node`, `pi`, `pi-dashboard`, `code-server`, `zrok`, `tmux`, `jq`, `git`, `curl`, `rg`, `fdfind`, `bash`

#### Scenario: Image runs as non-root user
- **WHEN** a container starts from the image
- **THEN** all processes run as user `pi` (UID 1000)

#### Scenario: node-pty works inside container
- **WHEN** the dashboard spawns a terminal via node-pty
- **THEN** the PTY allocates successfully and shell I/O works (glibc-based Debian, not musl/Alpine)

### Requirement: Entrypoint seeds API keys on first run
The entrypoint script SHALL run a `seed-auth.js` script that reads provider API keys from environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`) and writes them to `~/.pi/agent/auth.json` with `0600` permissions. The seeding SHALL only occur if `auth.json` does not already exist. The entrypoint SHALL then start a tmux server and exec `pi-dashboard` with port configuration from environment variables.

#### Scenario: First run with API key env vars
- **WHEN** the container starts for the first time with `ANTHROPIC_API_KEY=sk-ant-xxx` set
- **THEN** `~/.pi/agent/auth.json` is created with the key and `0600` permissions

#### Scenario: Subsequent run preserves existing auth
- **WHEN** the container starts and `~/.pi/agent/auth.json` already exists in the volume
- **THEN** the seed script does NOT overwrite the file, regardless of env var values

#### Scenario: First run without any API keys
- **WHEN** the container starts with no `*_API_KEY` env vars set
- **THEN** no `auth.json` is created, and the dashboard starts normally (keys can be added via browser UI)

### Requirement: Docker Compose base configuration
The `compose.yml` SHALL define a single service `pi-dashboard` with: build context pointing to the project root, port mappings for dashboard (default 8000) and pi gateway (default 9999), named volumes for `pi-state` and `zrok-state`, tmpfs on `/tmp`, memory limits, and a healthcheck using `/api/health`. All ports and limits SHALL be configurable via environment variables with sensible defaults.

#### Scenario: Container starts with default configuration
- **WHEN** `docker compose up` is run with no `.env` file
- **THEN** the dashboard is accessible at `http://localhost:8000` and the pi gateway listens on port 9999

#### Scenario: Healthcheck detects running server
- **WHEN** the dashboard server is running inside the container
- **THEN** `docker compose ps` shows the service as healthy

#### Scenario: Named volumes persist across restarts
- **WHEN** the container is stopped and restarted
- **THEN** pi sessions, auth credentials, dashboard preferences, and zrok enrollment are preserved

### Requirement: Path-identical workspace mounts
The project SHALL mount host project directories into the container at their identical absolute paths (e.g. host `/Users/x/Project/a` mounts to container `/Users/x/Project/a`), read-write. The base `compose.yml` SHALL NOT include any workspace mounts. Two mechanisms SHALL be provided sharing one directory list: a wrapper `docker/up.sh` reading a `PI_WORKSPACES` path-separator list, and a hand-edited `compose.override.yml` documented via `compose.override.yml.example`. Workspace mounts SHALL NOT be placed under `/workspaces/`.

#### Scenario: User mounts a project directory at its host path
- **WHEN** the user runs `docker/up.sh` with `PI_WORKSPACES="/Users/x/Project/my-app"` (or adds the equivalent path-identical bind in `compose.override.yml`)
- **THEN** the dashboard can create pi sessions in `/Users/x/Project/my-app` inside the container, the files are visible and editable on the host, and log lines / session CWDs read identically to the host path

#### Scenario: Multiple workspace mounts from one list
- **WHEN** the user sets `PI_WORKSPACES` to three colon-separated host paths
- **THEN** all three are bind-mounted at their identical absolute paths and appear as pinnable workspace directories in the dashboard

### Requirement: Seed pinned directories on first run
The server SHALL read a `PI_DASHBOARD_PIN_DIRS` environment variable (path-separator list of absolute paths) and, only when no pinned directories are yet persisted, seed them into `pinnedDirectories` (normalized, symlink-resolved, deduped via the existing load path). On any run where pinned directories are already persisted, the env SHALL be ignored so user edits via the UI are never overwritten. The `docker/up.sh` wrapper SHALL pass the same `PI_WORKSPACES` list as `PI_DASHBOARD_PIN_DIRS`.

#### Scenario: Mounted dirs appear pinned out of the box
- **WHEN** a container starts for the first time with `PI_DASHBOARD_PIN_DIRS` set to the mounted workspace paths and an empty `pi-state` volume
- **THEN** those directories appear as pinned workspaces in the dashboard without any manual pinning

#### Scenario: User pin edits survive restart
- **WHEN** the user has pinned/unpinned directories via the UI (persisted in `pi-state`) and the container restarts with `PI_DASHBOARD_PIN_DIRS` still set
- **THEN** the persisted pinned list is used unchanged and the env value is ignored

### Requirement: Volume performance profiles
The `compose.yml` SHALL include commented volume configurations for three profiles: default (named volume, no special options), performance (ext4/xfs with `noatime,data=writeback,barrier=0,commit=60`), and ephemeral (tmpfs with configurable size). Each profile SHALL be documented with its use case and trade-offs.

#### Scenario: Default profile works on all platforms
- **WHEN** the user uses the default volume configuration
- **THEN** volumes work on macOS (Docker Desktop), Linux, and Windows (Docker Desktop/WSL2)

#### Scenario: Performance profile reduces write latency
- **WHEN** the user configures the performance profile on a Linux host with a dedicated ext4 partition
- **THEN** the volume is mounted with `noatime,data=writeback,barrier=0,commit=60` options

#### Scenario: Ephemeral profile uses RAM-backed storage
- **WHEN** the user configures the ephemeral profile
- **THEN** the volume uses tmpfs and data is lost on container restart

### Requirement: Pi gateway external access control
The pi gateway bind address SHALL be configurable via `PI_GATEWAY_BIND` environment variable, defaulting to `0.0.0.0` (accepts external connections). Setting it to `127.0.0.1` SHALL restrict the gateway to container-internal connections only. The compose `ports` mapping for port 9999 SHALL also be configurable via `PI_GATEWAY_PORT` env var.

#### Scenario: External pi sessions connect by default
- **WHEN** the container starts with default configuration
- **THEN** pi sessions running on other machines can connect to port 9999

#### Scenario: Gateway locked to internal only
- **WHEN** `PI_GATEWAY_BIND=127.0.0.1` is set in `.env`
- **THEN** only pi sessions inside the container can connect to the gateway

#### Scenario: Gateway port disabled
- **WHEN** `PI_GATEWAY_PORT` is empty or unset in `.env` and the compose override removes the port mapping
- **THEN** port 9999 is not published on the host

### Requirement: Dev mode compose overlay
A `compose.dev.yml` SHALL provide a development overlay that bind-mounts the dashboard source code into the container, exposes the Vite HMR port (5173), uses an anonymous volume for `node_modules` to prevent host/container platform mismatch, and sets `NODE_ENV=development`.

#### Scenario: Source changes trigger Vite HMR
- **WHEN** the dev overlay is active and the user edits a client source file on the host
- **THEN** Vite hot module replacement picks up the change in the browser

#### Scenario: node_modules use container binaries
- **WHEN** the dev overlay is active
- **THEN** `node_modules/node-pty` contains Linux-compiled native addons (from container), not host macOS addons

### Requirement: Environment configuration documented in .env.example
A `.env.example` file SHALL document all configurable environment variables with comments explaining each. Variables SHALL include: API keys, ports, gateway bind address, zrok token, tunnel enabled flag, spawn strategy, and resource limits.

#### Scenario: User copies .env.example to .env
- **WHEN** the user copies `.env.example` to `.env` and fills in their API key
- **THEN** the container starts with that key seeded into auth.json

### Requirement: Electron remote mode in wizard
The Electron first-run wizard SHALL offer a third mode "Remote" alongside "Standalone" and "Power User". The remote mode SHALL present a URL input field and a "Test Connection" button. The `ModeConfig` type SHALL be extended with `mode: "remote"` and an optional `remoteUrl: string` field. The mode SHALL be persisted to `~/.pi-dashboard/mode.json`.

#### Scenario: User selects remote mode with valid URL
- **WHEN** the user selects "Remote" mode, enters `http://docker-host:8000`, and clicks "Test Connection"
- **THEN** the wizard calls `GET http://docker-host:8000/api/health`, shows success, and enables the "Continue" button

#### Scenario: User selects remote mode with unreachable URL
- **WHEN** the user selects "Remote" mode, enters a URL, and the health check fails
- **THEN** the wizard shows an error message and the "Continue" button remains disabled

#### Scenario: Remote mode persisted to mode.json
- **WHEN** the user completes the wizard in remote mode with URL `http://docker-host:8000`
- **THEN** `~/.pi-dashboard/mode.json` contains `{ "mode": "remote", "remoteUrl": "http://docker-host:8000" }`

### Requirement: Electron ensureServer skips local discovery in remote mode
When `mode.json` specifies `mode: "remote"`, the `ensureServer()` function SHALL return the configured `remoteUrl` directly without performing mDNS discovery, localhost health checks, or local server spawning. The `didWeStartServer()` function SHALL return `false` in remote mode, so `stopServerIfNeeded()` is a no-op on quit.

#### Scenario: Electron starts in remote mode
- **WHEN** the Electron app starts with `mode.json` set to `{ "mode": "remote", "remoteUrl": "http://docker-host:8000" }`
- **THEN** `ensureServer()` returns `http://docker-host:8000` without any network probing or process spawning

#### Scenario: Electron quit does not stop remote server
- **WHEN** the Electron app is quit in remote mode
- **THEN** no shutdown request is sent to the remote server
