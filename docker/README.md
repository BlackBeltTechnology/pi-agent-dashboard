# pi-dashboard in Docker

Run the entire pi-dashboard ecosystem — server, pi coding agent, zrok, tmux,
terminals — in one self-contained container. No host install of pi, Node, or
any tool required.

## Quick start

```bash
cd docker
cp .env.example .env          # add your ANTHROPIC_API_KEY (optional)
docker compose up -d --build
open http://localhost:8000
```

That's it. The dashboard is at `http://localhost:8000`; the pi gateway listens
on `9999`. State (sessions, auth, preferences) persists in the `pi-state`
named volume across restarts; the credential data key lives in the separate
`pi-key` volume (see [Credential key volume](#credential-key-volume-pi-key)).

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

**Zrok v2 in the image.** Image ships `zrok v2.0.4` (`zrok2` binary). Tarball extracts `zrok2` with a symlink `zrok → zrok2` for command compatibility. When `ZROK_TOKEN` set, entrypoint enrolls headless (via `zrok2 enable <token> --headless`), avoiding TTY requirement in server context. Config dir `~/.zrok2` persists across restarts via volume.

## Workspaces (path-identical mounts)

Mount host project directories at their **identical absolute path** inside the
container (host `/Users/x/Project/a` → container `/Users/x/Project/a`). Path
parity makes container logs, session CWDs, and git roots read identically to
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

## Credential key volume (`pi-key`)

The vault (`~/.pi/dashboard/vault.json`) and the plugin credential store
(`~/.pi/agent/plugin-credentials.json`) are **encrypted at rest**. A container
has no OS keychain, so the data key lives in a `0600` file on its **own**
volume, mounted at `/home/pi/.pi-key` (default path `/home/pi/.pi-key/data-key`).
`compose.yml` mounts the named volume `pi-key` there next to `pi-state`.

- **First start.** `entrypoint.sh` exports `PI_DASHBOARD_DATA_KEY_FILE=/home/pi/.pi-key/data-key`
  and generates 32 random bytes (base64) under `umask 077` when the file is
  absent and no credential file is encrypted yet. The key never appears in
  argv, env or logs.
- **Custom Compose files and plain `docker run` MUST mount `/home/pi/.pi-key`
  as a named volume.** The image's `VOLUME` line alone creates an *anonymous*
  volume, which `docker compose down -v` or a fresh `docker run` discards; the
  entrypoint prints a warning naming `/home/pi/.pi-key` in that case.
  ```bash
  docker run -v pi-state:/home/pi/.pi -v pi-key:/home/pi/.pi-key ...
  ```
- **Back it up separately.** A copy of `pi-state` alone (backup, sync) carries
  no key, which is the point; restore both volumes together. If the key volume
  is lost but `pi-state` holds encrypted files, the entrypoint **refuses to
  generate** a new key (it could not decrypt them), prints the restore remedy and
  starts the server anyway: the files are reported locked (`key_file_missing`).
  Restore `data-key` (mode `0600`) from your backup, or see the FAQ on key loss.
- **Bring your own key.** Set `PI_DASHBOARD_DATA_KEY_FILE=<abs path>` to a file
  you created (`openssl rand -base64 32 > <file>; chmod 600 <file>`). A preset
  path is never overridden and never generated. A Compose file secret
  (`/run/secrets/...`) is mounted `0444` and is rejected as insecure: copy it
  into a `0600` file first.
- **Not a sandbox.** pi sessions run as the same user in the same container, so
  the key file protects against copies of the `pi-state` volume, not against a
  process inside the container.
- **Licence.** The image ships `@napi-rs/keyring`'s Linux
  `LICENSE.third-party.md` (statically linked `libdbus`, `AFL-2.1 OR GPL-2.0-or-later`)
  under `/app/node_modules/@napi-rs/keyring-linux-*-gnu/`; the build fails if it is missing.

## Pi gateway external access

Two layers of control:

- **Compose ports** — `PI_GATEWAY_BIND=127.0.0.1` publishes the gateway port
  only on the Docker host loopback; `0.0.0.0` (default) exposes it to other
  machines. Empty `PI_GATEWAY_PORT` + removed mapping = not published at all.
- **Remote pi sessions** — on the other machine set
  `PI_DASHBOARD_URL=ws://<docker-host>:9999` (the gateway port) and
  `PI_DASHBOARD_TOKEN`. The bridge sends its HTTP calls (ticket mint, identity
  check) to the web UI port: `DASHBOARD_PORT` on that machine
  (`PI_DASHBOARD_PORT`, default `8000`). If your published web port differs, or
  a proxy fronts it, set `PI_DASHBOARD_HTTP_URL=http(s)://<docker-host>[:port]`
  there. `bridge ticket wrong-origin` in the pi log means the resolved origin is
  not the dashboard's HTTP listener.

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

## Diagram rendering (Kroki overlay)

```bash
docker compose -f compose.yml -f compose.kroki.yml up -d
```

The Kroki overlay (`compose.kroki.yml`) adds a `yuzutech/kroki` service for
local PlantUML and text-to-diagram rendering without remote egress. It sets
`KROKI_SAFE_MODE=secure` (blocks SSRF via `!include` / `!includeurl`), exposes
no host ports, and sets `KROKI_URL=http://kroki:8000` on `pi-dashboard` atomically.

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

- **Single container by design.** pi sessions, terminals (node-pty), and the
  gateway share one filesystem and localhost. A multi-container split fights
  the architecture.
- **Debian, not Alpine.** node-pty needs glibc for correct PTY behavior.
- **Non-root.** All processes run as user `pi` (UID 1000).

## Memory Sizing & Container Limits

Server 1536 MB V8 heap implies ~2.5–3 GB RSS. Process holds ~1.07 GB outside V8 (native buffers, compiled code, allocator fragmentation).

Container memory limit below ~2.5–3 GB causes kernel OOM SIGKILL before V8 reaches heap ceiling. Kernel terminates process without heap dump, without GC telemetry, without `FATAL ERROR: Reached heap limit` log. Failure is silent.

Floor: 4 GB for all-in-one image. `docker/compose.yml` sets default `MEM_LIMIT:-4g`. Default provides required headroom for server baseline.

4 GB container ceiling is shared across co-tenants:
- Dashboard server (~2.5–3 GB RSS peak).
- Spawned pi sessions (512 MB V8 heap ceiling each + uncapped keeper processes).
- Background services (zrok tunnel, tmux server, code-server).

Server at ~2.5–3 GB leaves under 1 GB for all co-tenants combined. Operators running multiple concurrent pi sessions must raise `MEM_LIMIT` in `.env`.

Known gap: bare host with <=2 GB RAM has no OOM guard.

See change: bound-session-heap-and-gc-telemetry.

