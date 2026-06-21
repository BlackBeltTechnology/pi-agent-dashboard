## 1. Dockerfile

- [x] 1.1 Create `docker/Dockerfile` with `base` stage: `node:22-bookworm-slim`, install system packages (tmux, jq, git, curl, ripgrep, fd-find, build-essential, python3)
- [x] 1.2 Add code-server binary install to `base` stage (pinned version via `ARG`, install.sh script)
- [x] 1.3 Add zrok binary install to `base` stage (pinned version via `ARG`)
- [x] 1.4 Create `app` stage: non-root `pi` user (UID 1000), install `@mariozechner/pi-coding-agent` globally
- [x] 1.5 Copy dashboard source, run `npm install` + `npm run build`, remove build-essential and python3
- [x] 1.6 Set `EXPOSE 8000 9999`, define `VOLUME` declarations, set default `CMD`

## 2. Entrypoint and Auth Seeding

- [x] 2.1 Create `docker/scripts/seed-auth.js`: read `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` env vars, write `auth.json` with `0600` permissions, skip if file exists
- [x] 2.2 Create `docker/entrypoint.sh`: run seed-auth.js, start tmux server, exec `pi-dashboard` with env-driven port flags
- [x] 2.3 Add `entrypoint.sh` to Dockerfile (`COPY`, `chmod +x`, `ENTRYPOINT`)

## 3. Docker Compose Base

- [x] 3.1 Create `docker/compose.yml`: single `pi-dashboard` service with build context, `init: true`, env-driven port mappings
- [x] 3.2 Add named volumes (`pi-state`, `zrok-state`), tmpfs on `/tmp`, volume mount targets in service
- [x] 3.3 Add healthcheck (`curl -f http://localhost:8000/api/health`), resource limits (memory), restart policy
- [x] 3.4 Add environment variables section with defaults for `DASHBOARD_PORT`, `PI_GATEWAY_PORT`, `PI_GATEWAY_BIND`, `PI_SPAWN_STRATEGY`, `TUNNEL_ENABLED`

## 4. Volume Performance Profiles

- [x] 4.1 Add commented volume configurations in `compose.yml` for default, performance (ext4 `noatime,data=writeback,barrier=0,commit=60`), and ephemeral (tmpfs `size=2g`) profiles
- [x] 4.2 Document each profile's use case and trade-offs as inline comments

## 5. Workspace and Override Files

- [x] 5.1 Create `docker/compose.override.yml.example` with **path-identical** workspace bind mounts (host `/Users/x/Project/a` → container `/Users/x/Project/a`, not `/workspaces/<name>`), read-only mount example, and instructions
- [x] 5.2 Create `docker/compose.dev.yml`: bind-mount source, anonymous volume for `node_modules`, expose Vite HMR port 5173, `NODE_ENV=development`
- [x] 5.3 Create `docker/up.sh`: parse `PI_WORKSPACES` path-separator list, generate one `-v <dir>:<dir>` RW bind per entry, export the same list as `PI_DASHBOARD_PIN_DIRS`, then `docker compose up`
- [x] 5.4 Server change: in `packages/server/src/preferences-store.ts`, on load seed `pinnedDirectories` from `PI_DASHBOARD_PIN_DIRS` (existing normalize/symlink-resolve/dedupe) only when no pinned dirs are persisted; ignore env otherwise. Add a unit test for first-run-seed vs persisted-wins

## 6. Environment Configuration

- [x] 6.1 Create `docker/.env.example` with all knobs: API keys, ports, gateway bind, zrok token, tunnel flag, spawn strategy, resource limits, `PI_WORKSPACES` (path-identical mount list), `PI_DASHBOARD_PIN_DIRS` (first-run pin list) — each with explanatory comments
- [x] 6.2 Add `docker/.gitignore` to exclude `.env` and `compose.override.yml` (user-specific files)

## 7. Electron Remote Mode

- [x] 7.1 Extend `ModeConfig` type in `packages/electron/src/lib/wizard-state.ts`: add `"remote"` to mode union, add optional `remoteUrl` field, update `readModeFile()` and `writeModeFile()` to handle the new mode
- [x] 7.2 Modify `ensureServer()` (DEVIATION: live startup path is `main.ts`+`launch-source.ts`, not `ensureServer()`; per user Option 1 also added remote short-circuit in `main.ts` startup + a `wizard:persist-mode` IPC/preload method so remote mode works end-to-end, not just the tray retry path) in `packages/electron/src/lib/server-lifecycle.ts`: when mode is `"remote"`, return `remoteUrl` directly (skip mDNS, health check, spawn)
- [x] 7.3 Wired existing wizard.html remote-URL Test/Use-this-server form to persist `{mode:"remote",remoteUrl}` via `wizard:persist-mode` to wizard renderer with URL input field and "Test Connection" button (calls `GET <url>/api/health`)
- [x] 7.4 Test: `remote-mode.test.ts` — mode.json round-trip, `ensureServer()` returns url (no probe/spawn), `didWeStartServer()` false to `mode.json`, `ensureServer()` returns URL, `didWeStartServer()` returns false, quit sends no shutdown request

## 8. Documentation

- [x] 8.1 Create `docker/README.md` with quick-start guide, volume profiles explanation, workspace setup, dev mode, external gateway configuration, Electron remote-mode connection
- [x] 8.2 Update project `AGENTS.md` with Docker section (build/run commands + pointers; per repo doc protocol, per-file detail routed to new `docs/file-index-docker.md` split, not AGENTS.md)
- [x] 8.3 Update project `README.md` with Docker deployment section
