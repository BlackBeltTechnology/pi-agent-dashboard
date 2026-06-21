## Context

The pi-dashboard is a three-component system (bridge extension, Node.js server, React web client) that also orchestrates external tools: pi coding agent, code-server, zrok tunnels, tmux, and terminal PTYs via node-pty. Currently all these tools must be installed manually on the host. There is no containerized deployment option.

The dashboard server already manages the lifecycle of these tools (spawning pi sessions, starting/stopping code-server, creating tunnels, managing terminals), making it a natural "init process" for a container.

## Goals / Non-Goals

**Goals:**
- Package the entire ecosystem into a single Docker image that works out of the box
- Support workspace isolation via per-project volume mounts
- Provide volume performance profiles for I/O-intensive workloads (session JSONL writes)
- Support both pre-configured API keys (env vars) and browser-based provisioning
- Allow external pi sessions to connect to the containerized server (configurable)
- Provide a dev-mode compose overlay for dashboard development

**Non-Goals:**
- Multi-container architecture (components are inherently colocated)
- Kubernetes manifests or Helm charts (Docker Compose only)
- Custom filesystem images or block device management (use host FS via mount options)
- Windows container support
- Modifying the web client (it already supports remote servers)

## Decisions

### Decision 1: Single container with dashboard as process manager

**Choice**: One container, `pi-dashboard` is the main process.

**Alternatives considered**:
- **Multi-container (rejected)**: pi sessions need shared filesystem with code-server, tmux can't spawn across containers, node-pty needs localhost access. Would require complex networking and shared volumes between every container.
- **supervisord (rejected)**: Adds Python dependency, duplicates process management the dashboard already does.
- **s6-overlay (rejected)**: Adds complexity; the dashboard server already manages all child process lifecycles.

**Rationale**: The dashboard server already handles spawning pi sessions (headless or tmux), managing code-server instances, starting/stopping zrok, and PTY lifecycle. It is already a process manager. Using `init: true` in compose (tini) handles PID 1 zombie reaping.

### Decision 2: `node:22-bookworm-slim` base image

**Choice**: Debian Bookworm slim with Node.js 22 LTS.

**Alternatives considered**:
- **Alpine (rejected)**: `node-pty` requires glibc for proper PTY support. Alpine's musl causes subtle terminal emulation bugs. The `fix-pty-permissions.cjs` postinstall script already hints at platform sensitivity.
- **Ubuntu (rejected)**: Larger image, no advantage over Debian slim for this use case.
- **Distroless (rejected)**: Needs bash, tmux, git, and other shell tools at runtime.

### Decision 3: Multi-stage Dockerfile with build-tool cleanup

**Choice**: Two stages — `base` installs system tools + binaries, `app` installs Node packages and builds the client. Build-essential is removed after native addon compilation.

**Rationale**: `node-pty` needs `build-essential` + `python3` for native compilation, but these aren't needed at runtime. Removing them saves ~200MB.

### Decision 4: Entrypoint seeds auth.json from env vars (first-run only)

**Choice**: `entrypoint.sh` runs `seed-auth.js` which reads `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc. and writes `~/.pi/agent/auth.json` with `0600` permissions — but only if the file doesn't exist.

**Rationale**: This supports two provisioning paths without conflict:
1. First run with `.env` → keys seeded, persisted in volume
2. Subsequent runs → volume has keys, env vars ignored
3. Users can always add/change providers via dashboard Settings UI

Writing with Node.js (not bash) avoids fragile JSON construction in shell scripts.

### Decision 5: Volume layout with three performance profiles

**Choice**: Named volumes for `pi-state` and `zrok-state`, bind mounts for workspaces. Three documented profiles:

| Profile | Driver | Mount options | Use case |
|---------|--------|---------------|----------|
| Default | `local` | (none) | Development, moderate usage |
| Performance | `local` | `noatime,data=writeback,barrier=0,commit=60` | Many concurrent sessions, heavy JSONL |
| Ephemeral | `local` (tmpfs) | `size=2g,noatime` | CI/CD, throwaway experiments |

**Rationale**: Session JSONL files are append-heavy. `noatime` eliminates unnecessary access-time writes. `data=writeback` journals only metadata (not data), significantly faster for small appends. `tmpfs` gives maximum speed when persistence isn't needed.

### Decision 6: Path-identical workspace mounts, driven by a list, auto-pinned

**Choice**: Host project directories mount into the container at the **identical absolute path** (`/Users/robson/Project/a` → `/Users/robson/Project/a`), read-write, not under `/workspaces/<name>`. Two ways to add them, sharing one list:
- **Wrapper `docker/up.sh`** (convenience): reads `PI_WORKSPACES="/path/a:/path/b:/path/c"`, generates one `-v <dir>:<dir>` bind per entry, and passes the same list as `PI_DASHBOARD_PIN_DIRS` so each mounted dir is auto-pinned on first run.
- **Hand-edited `compose.override.yml`** (power users): path-identical bind-mount examples, documented in `.example`.

**Rationale**: Path parity makes container log lines, session CWDs, and jj/git roots read identically to host paths — a path copied from a container log resolves on the host. The dashboard already pins arbitrary absolute paths (`preferences-store.ts` `pinnedDirectories`, no prefix restriction, persisted in the `pi-state` volume), so path-identical mounts are first-class with zero server change for the *mount*. Direct RW bind (no overlay) because a deployment edits real files. `/workspaces/<name>` is dropped: it forced log/path divergence for no benefit in a single-user deployment.

**Note**: Docker Compose cannot expand a list env into N volumes natively — hence the wrapper. The override file remains the no-code escape hatch.

### Decision 6b: Seed pinned directories on first run (small server change)

**Choice**: Add a `PI_DASHBOARD_PIN_DIRS` env var (path-separator list). On first run only (when `pinnedDirectories` is empty / not yet persisted), `preferences-store` seeds it into `pinnedDirectories`. Subsequent runs respect user edits made via the UI (never re-seed over a non-empty persisted list).

**Rationale**: Without seeding, a freshly-started container shows no pinned workspaces until the user pins each via the UI. Seeding makes "mount a dir → it appears pinned" true out of the box. First-run-only guard mirrors the existing auth-seed pattern (`seed-auth.js` skips if file exists) so it never fights user state. This is the only server-code change in docker-packaging; it lands in `preferences-store.ts` (read env, dedupe, normalize, resolve symlinks — reuse the existing load-path normalization) plus a one-line call from the entrypoint/startup.

**Reference sketch — `docker/up.sh`** (one list → mounts + pins, path-identical):

```bash
#!/usr/bin/env bash
set -euo pipefail

# PI_WORKSPACES="/Users/x/Project/a:/Users/x/Project/b"  (path-separator list)
IFS=':' read -r -a WS <<< "${PI_WORKSPACES:-}"

mounts=()
for dir in "${WS[@]}"; do
  [ -z "$dir" ] && continue
  [ -d "$dir" ] || { echo "skip (not a dir): $dir" >&2; continue; }
  abs="$(cd "$dir" && pwd -P)"           # resolve to absolute, real path
  mounts+=( -v "${abs}:${abs}" )          # PATH-IDENTICAL, read-write
done

# Same list drives first-run pin seeding inside the container.
export PI_DASHBOARD_PIN_DIRS="${PI_WORKSPACES:-}"

exec docker compose run --rm --service-ports \
  "${mounts[@]}" \
  -e PI_DASHBOARD_PIN_DIRS \
  pi-dashboard
# (or: write the mounts into a generated compose.override.yml, then `docker compose up`)
```

**Reference sketch — `preferences-store.ts` first-run seed** (reuses existing load-path normalization):

```ts
// inside the load path, after rawPinned is read from disk:
let pinnedDirectories = normalizeResolveDedupe(data.pinnedDirectories ?? []);

if (pinnedDirectories.length === 0) {
  const seed = (process.env.PI_DASHBOARD_PIN_DIRS ?? "")
    .split(path.delimiter)        // ':' on POSIX, ';' on Windows
    .map(s => s.trim())
    .filter(Boolean);
  if (seed.length > 0) {
    pinnedDirectories = normalizeResolveDedupe(seed);  // same pipeline as stored paths
    // persisted on first save → subsequent runs see a non-empty list and skip seeding
  }
}
```

The `length === 0` gate is the entire first-run-only contract: any prior UI pin/unpin leaves a persisted (possibly empty-after-unpin) list — so to distinguish "never seeded" from "user unpinned everything", persist a `pinSeeded: true` marker on first seed and gate on that instead of array length. Implementer's choice; the marker is the robust form.

### Decision 7: Pi gateway bind address for external access control

**Choice**: Two-layer control — compose `ports` for network exposure, `PI_GATEWAY_BIND` env var for server-level bind address (`0.0.0.0` default, `127.0.0.1` to block external).

**Rationale**: Just not publishing port 9999 prevents host-level access, but the bind address adds defense-in-depth. External pi sessions (running on other machines) connecting to the containerized dashboard is a valid use case but should be opt-out.

## Risks / Trade-offs

**[Large image size (~2.5GB)]** → Acceptable for an all-in-one dev tool. Multi-stage build and cleanup keep it as small as practical. code-server alone is ~500MB.

**[node-pty native addon platform mismatch]** → The `app` stage builds node-pty inside the container (Debian/Linux), so the prebuild matches the runtime OS. Dev compose uses an anonymous volume for `node_modules` to prevent host macOS binaries from overriding.

**[Container security — pi agent has full bash access]** → By design. The pi agent needs shell access to work. Non-root user (`pi`, UID 1000) limits blast radius. No Docker socket or privileged mode needed.

**[Volume data loss with ephemeral profile]** → Clearly documented. tmpfs data is lost on container restart. Only recommended for CI/CD.

**[code-server/zrok version pinning]** → Pinned via build args with sensible defaults. Users can override at build time.

### Decision 8: Electron "Remote" mode for Docker-hosted servers

**Choice**: Add a third mode (`"remote"`) to the Electron wizard alongside `"standalone"` and `"power-user"`. In remote mode, `ensureServer()` returns the configured URL directly, skipping all local discovery and spawning.

**Alternatives considered**:
- **Use ServerSelector only (rejected)**: `ServerSelector` is a runtime switch in the web UI, but `ensureServer()` runs before the BrowserWindow loads. Without a remote mode, Electron would still try to discover/spawn a local server first, which fails or is unnecessary.
- **Auto-detect Docker via mDNS (deferred)**: mDNS can discover Docker containers on the LAN, but requires `network_mode: host` or UDP port 5353 forwarding. Better as a future enhancement — for now, explicit URL is reliable.

**Rationale**: The Electron app is already a thin shell — it discovers a server URL and opens a BrowserWindow. Adding a remote mode is ~50 lines: extend `ModeConfig` type, short-circuit `ensureServer()`, add a URL input to the wizard. The web client inside the BrowserWindow already handles everything else (dynamic WS URL, `ApiContext`, `ServerSelector`).

**What doesn't need to change**:
- Web client (`App.tsx`) — already constructs WS/API URLs from `window.location`
- `ServerSelector` — already shows remote servers and allows switching
- Terminal emulator — binary WS connections are relative to server URL
- code-server — iframe proxied through dashboard server
- File browsing — all REST API calls go through `ApiContext`

**[Risk] Remote server unreachable** → `showLoadingPage()` already handles this with retry + error display. No additional work needed.
