# pi-dashboard Docker test harness

A **disposable, fully isolated** pi-dashboard for manual browser QA and
clean-install verification. It runs the exact image `docker-packaging` builds,
and is structurally incapable of colliding with a dashboard already running on
your host.

> Layers on `compose.yml`. Adds no new image build — just a compose overlay,
> an entrypoint wrapper, two scripts, and baked VCS fixtures.

## Quick start

```bash
# From the project you want to test (its files are mounted, never modified):
cd /path/to/my-project
/path/to/pi-agent-dashboard/docker/test-up.sh        # build + run, attached

# Open the dashboard:
#   http://localhost:18000
# Manual QA with agent-browser:
#   agent-browser open http://localhost:18000

# In another terminal, tear everything down (discards all state):
/path/to/pi-agent-dashboard/docker/test-down.sh
```

First run builds the image (a few minutes). Subsequent runs reuse it.

## Isolation guarantees

A test instance cannot touch the host dashboard across any collision vector:

| Vector | Host dashboard | Test harness | Mechanism |
|---|---|---|---|
| home-lock | holds `~/.pi/dashboard` lock | own `$HOME=/home/pi` | container filesystem |
| `~/.pi` state | persists | wiped every run | `pi-state` → tmpfs |
| HTTP port | 8000 | dynamic 18000–18999 | hash-derived + probed, published port remap |
| pi gateway port | 9999 | dynamic 19000–19999 (loopback only) | port remap + `PI_GATEWAY_BIND=127.0.0.1` |
| mDNS advertise/browse | on | off | `PI_DASHBOARD_NO_MDNS=1` |
| LAN multicast | — | none | default bridge network (NAT) |
| zrok tunnel | optional | off | `TUNNEL_ENABLED=false` |

Verify after a run: `~/.pi` is byte-identical and your project is untouched.

## Parallel worktrees

Two `test-up.sh` instances from different git worktrees no longer collide.
Each derives a stable, free port pair and a unique compose project name from a
hash of `HOST_CWD` (`$PWD`). See change: parallelize-test-harness.

- **Ports** — `cksum(HOST_CWD)` picks a base offset inside a fixed window
  (dashboard `18000–18999`, gateway `19000–19999`), then probes for a free port,
  wrapping at the window edge. Same worktree → same ports across restarts.
- **Project name** — `pi-dash-test-<hash>`, a pure function of `HOST_CWD`, passed
  as `docker compose -p`. Distinct project → distinct containers/network/volume,
  so one worktree never recreates another's stack.
- **State file** — `${HOST_CWD}/.pi-test-harness.json` =
  `{ project, dashboardPort, gatewayPort }`. Gitignored. `test-down.sh`
  re-derives the project from `$PWD` (works even if the file is missing/corrupt)
  and removes it after `down`.
- **Override** — export **both** `DASHBOARD_PORT` and `PI_GATEWAY_PORT` to skip
  derivation (exactly one = error). The Playwright lifecycle uses this path.
- **Playwright** — `tests/e2e/lifecycle.ts` probes a free port (managed) or reads
  `PW_E2E_PORT` (default 18000) when attaching with `PW_E2E_USE_RUNNING=1`, and
  keeps `use.baseURL` in sync with the container.

## Path-parity mount

The directory you launch `test-up.sh` from (`$PWD`) is mounted into the
container at its **identical absolute path** (`HOST_CWD`), so logs, session
CWDs, and VCS roots read exactly as they do on the host.

Writes never reach the host. The host directory is the read-only *lower* layer
of an in-container overlayfs; the *upper* layer is a throwaway tmpfs:

```
host ${HOST_CWD}  ──(bind, ro)──▶  /mnt/test-lower          (lowerdir)
tmpfs (size=2g)                    /mnt/test-overlay/upper  (upperdir)
  └─ same fs (overlay rule)        /mnt/test-overlay/work   (workdir)
   mount -t overlay overlay -o lower,upper,work  ${HOST_CWD}
```

Container sees `${HOST_CWD}` writable; reads fall through to the host (ro);
writes land in the tmpfs upper; teardown discards the upper → host pristine.

### Overlay vs copy-mode

| Mode | Trigger | Capability | Cost |
|---|---|---|---|
| overlay (default) | — | `CAP_SYS_ADMIN` (added via `compose.test.cap.yml`) | instant spin-up; only written bytes use RAM |
| copy | `TEST_COPY_MODE=1` | none — cap file is not layered | `cp -a` upfront; RAM-heavy for big trees |

`test-up.sh` layers `compose.test.cap.yml` (which grants `CAP_SYS_ADMIN`) only in
overlay mode; with `TEST_COPY_MODE=1` it is omitted, so the container runs with
no added capability. Use copy-mode on hosts that forbid `SYS_ADMIN`:

```bash
cd /path/to/my-project
TEST_COPY_MODE=1 /path/to/pi-agent-dashboard/docker/test-up.sh
```

## Fixtures vs path-parity mount

Two orthogonal ways to get a workspace; neither required:

- **Baked fixtures** — `/fixtures/sample-git` is initialized as a real git repo
  at startup. Pin it from the UI to exercise the VCS panels with zero host
  coupling.
- **Path-parity mount** — the "open my real project" path (above). Launch
  `test-up.sh` from the project; it appears at its identical host path.

## UI-only vs end-to-end (key seeding)

By default **no provider keys are seeded** → panels render and navigate, but
agents do not run (UI-only QA).

For full agent runs, drop a key into a gitignored `docker/.env`:

```bash
# docker/.env  (gitignored)
ANTHROPIC_API_KEY=sk-ant-...
```

The base entrypoint seeds it into `auth.json` on first run (use a throwaway
test key — state is ephemeral anyway).

## Fail-fast smoke check

Before printing the ready URL, the entrypoint probes `GET /api/health` (200)
and a single `/ws` WebSocket connect. A broken image/build exits non-zero
**before** you open a browser.

## Files

| File | Role |
|---|---|
| `compose.test.yml` | overlay: isolation env, SYS_ADMIN, tmpfs state, mounts, entrypoint; container `DASHBOARD_PORT`/`PI_GATEWAY_PORT` interpolate `${…:-default}` |
| `lib-ports.sh` | sourced pure helpers: `derive_hash`, `derive_project`, `is_free`, `find_free_in_window` |
| `test-entrypoint.sh` | builds overlay, inits fixtures, smoke check, execs base entrypoint |
| `test-up.sh` | derives port pair + project from `HOST_CWD`, writes state file, `compose -p … up`, prints chosen URL |
| `test-down.sh` | re-derives project from `$PWD`, `compose -p … down -v`, removes state file |
| `fixtures/sample-git/` | git fixture source files |
