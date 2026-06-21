## Why

Testing pi-dashboard on the host collides with the real, running dashboard four ways:

1. **single-dashboard-per-home lock** — the lock/pidfile chain (`home-lock.d.ts` → `home-lock-release.ts` → `server-pid.ts`) is keyed off `os.homedir()` → `~/.pi/dashboard`. A second instance on the same `$HOME` fights the lock and refuses to start.
2. **mDNS collision/pollution** — `server.ts` advertises `_pi-dashboard._tcp` and browses for peers; a test instance leaks onto the LAN and pollutes the live dashboard's peer list.
3. **port collision** — host dashboard owns 8000 (HTTP) + 9999 (pi gateway); a second instance can't bind them.
4. **`~/.pi` state pollution** — sessions, auth, config of the test run bleed into the real state directory.

A throwaway, fully isolated container dissolves all four — three structurally (isolated `$HOME`, bridge network, mapped ports, ephemeral volume) and one via the existing `PI_DASHBOARD_NO_MDNS=1` flag. No server code changes. The result is a one-command disposable dashboard for manual browser QA and clean-install verification that can never touch the real dashboard.

## Depends On

This change DEPENDS ON `docker-packaging` landing first. That change provides the base image (`node:22-bookworm-slim`, in-image dashboard build, pi global install, volumes, and the `DASHBOARD_PORT` / `PI_GATEWAY_PORT` / `PI_GATEWAY_BIND` / `TUNNEL_ENABLED` / `PI_AUTH_*` env knobs). This change adds a test-only compose overlay, spin/teardown scripts, fixtures, and a runbook on top of that image — it adds **no** new image build.

This change also REQUIRES one amendment to `docker-packaging`: its Dockerfile must install `jj` (jujutsu), `gh` (GitHub CLI), and `openspec` in addition to the tools it already lists (code-server, zrok, tmux, jq, git, ripgrep, fd-find). Those three are spawned/probed by the dashboard but absent from the current docker-packaging task list — a packaging gap, fixed there, not here.

## What Changes

Add test-only files under `docker/` that overlay the docker-packaging base image into an isolated, ephemeral, manual-QA instance.

### Files

**`docker/compose.test.yml`** — Test overlay (`docker compose -f compose.yml -f compose.test.yml up`):
- `PI_DASHBOARD_NO_MDNS=1` — discovery silent, never advertises or browses peers
- `DASHBOARD_PORT=18000`, `PI_GATEWAY_PORT=18999` — mapped to non-colliding host ports
- `PI_GATEWAY_BIND=127.0.0.1` — rejects external pi sessions
- `TUNNEL_ENABLED=false` — zrok present in image but not started
- code-server present but not auto-launched
- `pi-state` → `tmpfs` — ephemeral, wiped every run; zero `~/.pi` pollution
- `network` default bridge — multicast cannot leak to host LAN
- `PI_AUTH_*` unset by default (UI-only); opt-in via `.env` for e2e agent runs
- `cap_add: [SYS_ADMIN]` — entrypoint can build the path-parity overlay (see below)

**`docker/test-entrypoint.sh`** — Wraps the base entrypoint to build the path-parity overlay before exec'ing the dashboard:
- Reads `HOST_CWD`; if set, builds an overlayfs at the identical path (host dir as read-only lower, tmpfs upper) so the container sees `${HOST_CWD}` writable while host files stay untouched
- `TEST_COPY_MODE=1` fallback: `cp -a` the read-only lower into a tmpfs at `${HOST_CWD}` (zero capabilities, for hosts that forbid `SYS_ADMIN`)
- Runs a tiny smoke check (HTTP `/api/health` + one WS connect) and fails fast (non-zero exit) before the instance is declared ready
- Delegates the rest to the base entrypoint

**`docker/test-up.sh`** — One-command spin-up:
- `export HOST_CWD="$PWD"` then `docker compose -f compose.yml -f compose.test.yml up`
- Prints the dashboard URL (`http://localhost:18000`) and the path-parity note

**`docker/test-down.sh`** — One-command teardown: `docker compose ... down -v` (drops tmpfs upper → host pristine, ephemeral state gone)

**`docker/fixtures/`** — Baked sample workspaces for VCS-panel testing without mounting a host project:
- `fixtures/sample-git/` — a small initialized git repo
- `fixtures/sample-jj/` — a small initialized jj repo

**`docker/TESTING.md`** — Runbook: quick start, the isolation-guarantee table, path-parity explanation, overlay vs copy-mode tradeoff, fixture vs path-parity-mount usage, UI-only vs e2e (key seeding), and the `agent-browser → http://localhost:18000` manual-QA entry.

### Path-Parity Mount (shares docker-packaging's path-identical convention)

Both this harness and docker-packaging mount host directories at their **identical absolute path** inside the container (`${HOST_CWD}:${HOST_CWD}`, `working_dir=${HOST_CWD}`) so logs / session CWDs / jj-git roots read identically to host paths. The one difference is write semantics, matching each use case:
- **docker-packaging (deployment):** direct read-write bind — edits real host files (intended).
- **docker-test-harness (QA):** read-write onto a throwaway tmpfs overlay — writes land in the upper layer, host files never modified, teardown discards them.

This harness also mounts the single host CWD (the project under test), whereas docker-packaging supports a multi-directory `PI_WORKSPACES` list.

## Capabilities

### New Capabilities

- `docker-test-harness`: A disposable, fully isolated containerized pi-dashboard for manual browser QA and clean-install verification. Guarantees no collision with the host dashboard across home-lock, mDNS, ports, and `~/.pi` state. Provides path-identical workspace mounting onto a throwaway overlay, baked git/jj fixtures, a fail-fast smoke check, and a one-command spin/teardown.

### Existing Capabilities Modified

- `docker-packaging`: Dockerfile must additionally install `jj`, `gh`, and `openspec` (spawned/probed by the dashboard, currently missing from its task list).
