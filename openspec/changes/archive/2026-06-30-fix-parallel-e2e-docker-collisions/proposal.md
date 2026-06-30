## Why

The `parallelize-test-harness` change made the **manual** path (`docker/test-up.sh` run by hand) parallel-worktree-safe: stable per-worktree ports in disjoint windows + a unique compose project name. But the **managed Playwright e2e path** (`npm run test:e2e`) bypasses that machinery and still collides when two worktrees run `npm run test:e2e` at the same time:

1. **Port probe TOCTOU race.** `tests/e2e/lifecycle.ts:probeFreePort()` binds `:0`, grabs a random **ephemeral** OS port, *releases it*, and exports it verbatim. `test-up.sh` honours the exported pair and **skips `derive_ports`** — so the proven disjoint-window probe is never used. Two parallel runs can:
   - probe the **same** ephemeral number (the OS reuses a just-freed port), or
   - lose the port in the seconds-wide gap between probe-release and `docker compose up` actually binding it.
   Result: the second container fails to publish (`port is already allocated`) → never healthy → 180 s timeout → flaky e2e.

2. **Shared image tag `pi-dashboard:local` (silent, worse).** The image name in `compose.yml` is global to the Docker daemon, **not** project-scoped. `docker compose up` builds only when the tag is missing. So after the first run builds `pi-dashboard:local`, a parallel/subsequent run from a **different worktree reuses that image with no rebuild** — silently testing the *other* worktree's code. Two cold runs also race to build the same tag.

A harness whose whole purpose is non-collision must also not collide with itself across worktrees on the e2e path — both for liveness (port) and correctness (image).

## What Changes

Close both holes by unifying the managed e2e path onto the proven manual machinery, and scoping the image per worktree. No server code change.

- **`tests/e2e/lifecycle.ts`** — drop `probeFreePort()` for managed mode. Do **not** pre-pin `DASHBOARD_PORT`/`PI_GATEWAY_PORT`; let `test-up.sh` derive them in the disjoint windows. After boot, read the chosen ports back from the worktree's `.pi-test-harness.json` state file and set `process.env.PW_E2E_PORT`/`PW_GATEWAY_PORT` so `baseURL` + workers stay in sync. `USE_RUNNING` (attach) path unchanged.
- **`tests/e2e/global-setup.ts`** — stop exporting the port pair into the `test-up.sh` env. Boot from the throwaway workspace as today (unique `HOST_CWD` → unique hash → distinct window slot + project name), then resolve the actual ports from the state file before `waitForHealth`.
- **`docker/test-up.sh`** — wrap `docker compose up` in a **bounded retry** that re-derives the next free port in-window when the daemon reports `port is already allocated` (closes the residual probe→bind TOCTOU gap). Export a per-project image tag `TEST_IMAGE_TAG="$COMPOSE_PROJECT_NAME"`.
- **`docker/compose.test.yml`** — override `image: pi-dashboard:${TEST_IMAGE_TAG:-local}` so each worktree's stack builds/uses its **own** tag. The dashboard server + client run from BAKED image source (`Dockerfile` `COPY packages` + `/app` PATH link); the `HOST_CWD` overlay is only the managed workspace, not the app — so the per-worktree image is load-bearing for correctness. `--build` on the managed-path `up` is therefore **mandatory** (not an optimization): without it a run silently tests whichever worktree built the tag first. Distinct tags build in parallel safely; BuildKit caches all but the `COPY packages` layer.

## Capabilities

### Existing Capabilities Modified

- `docker-test-harness`: isolation guarantee extended to cover the **image** vector and the **probe→bind race** — a harness instance never reuses or clobbers another worktree's image, and recovers from a transient port-bind collision by re-deriving in-window.
- `playwright-e2e-qa`: the managed e2e lifecycle no longer probes raw ephemeral ports; it derives in the disjoint windows via `test-up.sh` and reads the chosen ports back from the state file, keeping Playwright's `baseURL` in sync with the container.

## Non-Goals

- Docker daemon resource contention (CPU/IO starvation under N parallel 4 GB containers) — a throughput concern, not a collision. Mitigate separately (host semaphore / lower `MEM_LIMIT`) if it bites.
- Changing the manual `test-up.sh` UX or the attach (`PW_E2E_USE_RUNNING=1`) fast path.
