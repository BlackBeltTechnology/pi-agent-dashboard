# pi-dashboard in Docker

Run the entire pi-dashboard ecosystem — server, pi coding agent, code-server,
zrok, tmux, terminals — in one self-contained container. No host install of
pi, Node, or any tool required.

## Quick start

```bash
cd docker
cp .env.example .env          # add your ANTHROPIC_API_KEY (optional)
docker compose up -d --build
open http://localhost:8000
```

That's it. The dashboard is at `http://localhost:8000`; the pi gateway listens
on `9999`. State (sessions, auth, preferences) persists in the `pi-state`
named volume across restarts.

You can also skip `.env` keys entirely and add providers later via
**Settings → Provider Auth** in the dashboard (OAuth or paste a key).

## Configuration

All knobs live in `.env` (copy from `.env.example`). Highlights:

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` | — | Seeded into `auth.json` on **first run only** |
| `DASHBOARD_PORT` | `8000` | Web UI / REST / browser WebSocket port |
| `PI_GATEWAY_PORT` | `9999` | Pi gateway port (external pi sessions) |
| `PI_GATEWAY_BIND` | `0.0.0.0` | Host publish interface for the gateway (`127.0.0.1` = host-only) |
| `PI_SPAWN_STRATEGY` | `tmux` | Session spawn strategy: `headless` or `tmux` |
| `TUNNEL_ENABLED` | `1` | `0` passes `--no-tunnel`; set `ZROK_TOKEN` to enroll |
| `MEM_LIMIT` | `4g` | Container memory ceiling |

API keys are seeded **once**: the first run writes `auth.json` into the
`pi-state` volume; later runs ignore the env vars (the volume wins). Change
providers anytime via the dashboard UI.

## Workspaces (path-identical mounts)

Mount host project directories at their **identical absolute path** inside the
container (host `/Users/x/Project/a` → container `/Users/x/Project/a`). Path
parity makes container logs, session CWDs, and git/jj roots read identically to
the host.

**Easy path — `up.sh`** (one list drives mounts *and* first-run pins):

```bash
PI_WORKSPACES="/Users/x/Project/a:/Users/x/Project/b" ./up.sh
```

Each listed dir is bind-mounted read-write and auto-pinned in the dashboard on
first run (via `PI_DASHBOARD_PIN_DIRS`).

**Power-user path — `compose.override.yml`:**

```bash
cp compose.override.yml.example compose.override.yml
# edit: add path-identical binds (and :ro for read-only), set PI_DASHBOARD_PIN_DIRS
docker compose up -d
```

First-run pin seeding only applies when no pins are persisted yet — once you
pin/unpin via the UI, your choices win and the env is ignored.

## Volume performance profiles

`compose.yml` ships three commented volume profiles for `pi-state`
(session JSONL writes are append-heavy):

1. **Default** — named volume. Works everywhere (macOS/Windows/Linux).
2. **Performance** — Linux dedicated ext4/xfs partition with
   `noatime,data=writeback,barrier=0,commit=60`. For many concurrent sessions.
3. **Ephemeral** — tmpfs (`size=2g`). Max speed, **data lost on restart**.
   CI/CD and throwaway only.

Uncomment one block per named volume in `compose.yml`.

## Pi gateway external access

Two layers of control:

- **Compose ports** — `PI_GATEWAY_BIND=127.0.0.1` publishes the gateway port
  only on the Docker host loopback; `0.0.0.0` (default) exposes it to other
  machines. Empty `PI_GATEWAY_PORT` + removed mapping = not published at all.

## Dev mode (Vite HMR)

```bash
docker compose -f compose.yml -f compose.dev.yml up
# then, to start Vite HMR inside the container:
docker compose -f compose.yml -f compose.dev.yml exec pi-dashboard npm run dev
```

The dev overlay bind-mounts the source, keeps the container's Linux-compiled
`node_modules` (anonymous volume — host node-pty binaries never shadow them),
exposes `5173`, and sets `NODE_ENV=development`. Without Vite running, `--dev`
falls back to the built client.

## Connect the Electron desktop app (Remote mode)

The Electron desktop app can attach to a Docker-hosted server with **no local
install**:

1. Launch the desktop app's first-run wizard.
2. Open the remote-connect form, enter `http://docker-host:8000`, click
   **Test Connection**.
3. On success, click **Use this server**. The app persists
   `{ mode: "remote", remoteUrl }` to `~/.pi-dashboard/mode.json` and attaches
   directly on every launch — skipping all local discovery and spawning. Quit
   never stops the remote server.

## Notes

- **Single container by design.** pi sessions, terminals (node-pty),
  code-server, and the gateway share one filesystem and localhost. A
  multi-container split fights the architecture.
- **Debian, not Alpine.** node-pty needs glibc for correct PTY behavior.
- **Non-root.** All processes run as user `pi` (UID 1000).
- **Image size** ~2.5 GB (code-server alone is ~500 MB).
