# DOX — docker

Files in this directory. One row per file. Non-source area. Subdir files owned by their own `AGENTS.md` (`fixtures/`, `scripts/`). See change: migrate-file-index-to-agents-tree. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `.env.example` | Container env knobs, each commented. API keys, `DASHBOARD_PORT`, `PI_GATEWAY_PORT`, `PI_GATEWAY_BIND`,… → see `.env.example.AGENTS.md` |
| `.gitignore` | Excludes `.env` + `compose.override.yml` (user-specific). See change: docker-packaging. |
| `compose.dev.yml` | Dev overlay. Bind-mounts source, anonymous node_modules volume keeps Linux node-pty, exposes 5173, `NODE_ENV=development`, command `start --dev`. See change: docker-packaging. |
| `compose.override.yml.example` | Power-user template. Path-identical workspace binds, `:ro` example, `PI_DASHBOARD_PIN_DIRS`. Copy to `compose.override.yml`. See change: docker-packaging. |
| `compose.kroki.yml` | Kroki diagram rendering overlay. Adds `yuzutech/kroki` with `KROKI_SAFE_MODE=secure` and no host ports, atomically sets `KROKI_URL=http://kroki:8000` on `pi-dashboard`. See change: diagram-rendering. |
| `compose.test.cap.yml` | Overlay-mode capability layer. Grants `cap_add: [SYS_ADMIN]` for `mount -t overlay` in test-entrypoint.sh. → see `compose.test.cap.yml.AGENTS.md` |
| `compose.test.yml` | Test overlay on `compose.yml`. Sets `PI_DASHBOARD_NO_MDNS=1`, `DASHBOARD_PORT="${DASHBOARD_PORT:-18000}"`,… → see `compose.test.yml.AGENTS.md` |
| `compose.yml` | Base compose. Service `pi-dashboard`, `init:true`, env-driven ports, named volumes `pi-state`→`/home/pi/.pi`… → see `compose.yml.AGENTS.md` |
| `Dockerfile` | Multi-stage. base: `node:24-bookworm-slim` +… → see `Dockerfile.AGENTS.md` |
| `entrypoint.sh` | Runs `seed-auth.js`, seeds spawnStrategy into config.json first-run-only, starts tmux server, enrolls zrok v2… → see `entrypoint.sh.AGENTS.md` |
| `harness-audit.sh` | Records `docker events` (`create`/`start`/`die`/`destroy`/`kill`) for the `pi-dash-test-*` label set into a file, so a container destroyed by a non-repo actor (#451 part 1) leaves evidence. `harness-audit.sh <outfile>`; start before `test-up.sh`. See change: stabilize-browser-e2e. |
| `lib-ports.sh` | Sourced pure-helper lib. Exports `derive_hash(cwd)` (cksum), `derive_project(cwd)` -> `pi-dash-test-<hash>`,… → see `lib-ports.sh.AGENTS.md` |
| `README.md` | User guide. Quick-start, config table, path-identical workspace mounts, volume perf profiles, gateway access, dev mode, Electron remote mode. See change: docker-packaging. Gains Memory Sizing & Container Limits: 1536 MB heap implies ~2.5-3 GB RSS (~1.07 GB lives outside V8); a limit below that is SIGKILLed before V8 reaches its ceiling — no heap dump, no GC telemetry, no `FATAL ERROR` line. Floor 4 GB; `compose.yml` already ships `MEM_LIMIT:-4g`. 4 GB is SHARED with co-tenants. Bare host ≤2 GB is a named gap. See change: bound-session-heap-and-gc-telemetry. |
| `supervise-daemon.sh` | `supervise_daemon <pidfile> [label]` — keeps PID 1 alive for a DETACHED dashboard daemon, sourced by BOTH… → see `supervise-daemon.sh.AGENTS.md` |
| `test-down.sh` | Teardown. Re-derives `COMPOSE_PROJECT_NAME` from `$PWD` via lib-ports.sh cksum. → see `test-down.sh.AGENTS.md` |
| `test-entrypoint.sh` | Test entrypoint wrapper. `HOST_CWD` set → mounts overlayfs (lower `/mnt/test-lower` ro, upper/work tmpfs) at… → see `test-entrypoint.sh.AGENTS.md` Seeds the windowed-session fixture via `scripts/seed-sessions-window.mjs` under `PI_E2E_SEED`. See change: fix-connect-snapshot-frame-loss. |
| `test-up.sh` | Spin-up. Sources lib-ports.sh. Exports `HOST_CWD=$PWD`. Derives stable port pair + `COMPOSE_PROJECT_NAME`… → see `test-up.sh.AGENTS.md` |
| `TESTING.md` | Runbook for disposable isolated test harness. Quick start. → see `TESTING.md.AGENTS.md` |
| `up.sh` | Workspace launcher. Parses `PI_WORKSPACES` path-separator list, one path-identical `-v dir:dir` RW bind per… → see `up.sh.AGENTS.md` |
