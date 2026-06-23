## Why

The disposable test harness (`docker-test-harness`) hardcodes host ports `18000` / `18999` and runs under a single implicit compose project name (`docker`, the basename of the compose dir). That was fine for one instance, but parallel git worktrees each running `./test-up.sh` collide three ways:

1. **Host port collision** — `compose.yml` publishes `${DASHBOARD_PORT}:…` and `${PI_GATEWAY_PORT}:…`; two instances both try to bind `18000` / `18999`. The second `docker compose up` dies with *"port is already allocated"*.
2. **Compose project-name collision (silent, worse)** — no `-p` / `COMPOSE_PROJECT_NAME` is set, so every worktree shares project `docker`. A second `up` **recreates/attaches the first worktree's containers** instead of starting its own, and `test-down.sh` from either worktree tears down whichever stack is named `docker`. Worktrees corrupt each other with no error.
3. **Downstream contract drift** — `compose.test.yml` hardcodes the container env `DASHBOARD_PORT: "18000"` / `PI_GATEWAY_PORT: "18999"` as literals (not `${…}`), and `tests/e2e/lifecycle.ts` hardcodes `HEALTH_URL = http://localhost:18000`. Even if `test-up.sh` picked a free host port today, the container would still listen on 18000 (mismatch) and Playwright would probe the wrong port.

A QA harness whose whole purpose is *non-collision with the host dashboard* must also not collide with **itself across worktrees**. This change makes each instance pick a stable, free port pair and run under a unique compose project name, recorded in a per-worktree state file that teardown and the Playwright lifecycle read back.

## What Changes

Make the harness parallel-worktree-safe. No image rebuild, no server code change.

- **`docker/test-up.sh`** — honour pre-exported `DASHBOARD_PORT` / `PI_GATEWAY_PORT` **as a pair** (e2e path; exactly one set = error); else **derive a stable port pair from a hash of `HOST_CWD`** (same worktree → same ports across restarts) and **probe within disjoint windows** (dashboard 18000–18999, gateway 19000–19999) for actual freeness, wrapping at the window edge so a scan never crosses into the other window. Derive a unique `COMPOSE_PROJECT_NAME` from the same hash (pure function of `HOST_CWD`), pass `-p`. Write `${HOST_CWD}/.pi-test-harness.json` = `{ project, dashboardPort, gatewayPort }`. Print the chosen URL (no longer always `:18000`).
- **`docker/compose.test.yml`** — de-hardcode the container env: `DASHBOARD_PORT: "${DASHBOARD_PORT:-18000}"`, `PI_GATEWAY_PORT: "${PI_GATEWAY_PORT:-18999}"` so the published host port and the in-container listen port stay in sync.
- **`docker/test-down.sh`** — re-derive the project name from `${PWD}` (same pure function as `test-up.sh`) → `down -v` the **matching `-p <project>`** stack, then remove the state file. Works even when the state file is missing or corrupt (state file carries ports, not identity).
- **`tests/e2e/lifecycle.ts`** — compute the port once (env `PW_E2E_PORT` or a probed free port in managed mode), derive `HEALTH_URL` + `BASE_URL` from it, and export `DASHBOARD_PORT`/`PI_GATEWAY_PORT` into the `test-up.sh` spawn env so Playwright and the container agree. `playwright.config.ts` reads `BASE_URL` from the same module.
- **`.gitignore`** — ignore `.pi-test-harness.json`.

## Capabilities

### Existing Capabilities Modified

- `docker-test-harness`: isolation guarantee extended from *"no collision with the host dashboard"* to *"no collision with the host dashboard **or with any other harness instance on the same host (parallel worktrees)**"*. Adds stable per-worktree port derivation, unique compose project name, and a per-worktree state file consumed by teardown.
- `add-playwright-e2e`: the e2e lifecycle no longer assumes a fixed `:18000`; it selects/discovers the port and keeps Playwright's `baseURL` in sync with the container.
