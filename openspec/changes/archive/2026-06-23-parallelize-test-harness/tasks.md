# Tasks

## 1. Port + project derivation in test-up.sh

- [x] 1.1 Add `is_free()` helper to `docker/test-up.sh`: connect-check via bash `/dev/tcp/127.0.0.1/$1`, return 0 when nothing is listening. No `nc`/`lsof` dependency (macOS + Linux).
- [x] 1.2 Add `find_free_in_window(start, lo, hi)`: probe `start`, then increment with wrap (`hi`→`lo`), visiting each port in `[lo..hi]` at most once (cap = `hi-lo+1` = 1000 tries). Return first free; `exit 1` naming the exhausted window + change name if all busy. Guarantees the dashboard scan never enters the gateway window.
- [x] 1.3 Compute `HASH=$(printf '%s' "$HOST_CWD" | cksum | cut -d' ' -f1)`. Windows: dashboard `[18000..18999]`, gateway `[19000..19999]`. Derive `base_dash=18000 + HASH%1000`, `base_gw=19000 + HASH%1000`.
- [x] 1.4 Honour override **as a pair**: both `DASHBOARD_PORT` + `PI_GATEWAY_PORT` exported → use verbatim, skip probing; neither → `DASHBOARD_PORT=find_free_in_window(base_dash,18000,18999)`, `PI_GATEWAY_PORT=find_free_in_window(base_gw,19000,19999)`; **exactly one** exported → `exit 1` ("export both or neither").
- [x] 1.5 Derive `COMPOSE_PROJECT_NAME="pi-dash-test-${HASH}"` (lowercase, compose-legal). Export it; pass `-p "$COMPOSE_PROJECT_NAME"` to the compose invocation.
- [x] 1.6 Idempotent re-up: if `${HOST_CWD}/.pi-test-harness.json` exists AND `docker compose -p <project> ps -q` shows running containers, reuse its recorded ports instead of re-probing.

## 2. State file

- [x] 2.1 After resolving ports + project, write `${HOST_CWD}/.pi-test-harness.json` = `{ "project": "...", "dashboardPort": N, "gatewayPort": M }` (printf/heredoc; no jq dependency for writing).
- [x] 2.2 Update the printed banner to show the *chosen* URL `http://localhost:${DASHBOARD_PORT}` (no longer the literal `:18000`).
- [x] 2.3 Add `.pi-test-harness.json` to `.gitignore` (near the existing Playwright E2E block).

## 3. De-hardcode compose.test.yml

- [x] 3.1 In `docker/compose.test.yml` `environment:`, change `DASHBOARD_PORT: "18000"` → `DASHBOARD_PORT: "${DASHBOARD_PORT:-18000}"` and `PI_GATEWAY_PORT: "18999"` → `PI_GATEWAY_PORT: "${PI_GATEWAY_PORT:-18999}"`.
- [x] 3.2 Update the header comment block (ports line) to note ports are now dynamic per worktree, default window 18000/18999.

## 4. Teardown targets the right stack

- [x] 4.1 In `docker/test-down.sh`, **re-derive** the project name from `${PWD}` (same `cksum` pure function as test-up: `pi-dash-test-$(printf '%s' "$PWD" | cksum | cut -d' ' -f1)`). Pass `-p "$project"` to `docker compose ... down -v`. Does not depend on the state file for identity.
- [x] 4.2 Remove `${PWD}/.pi-test-harness.json` after a successful `down` (if present).
- [x] 4.3 Corrupt/missing state file: proceed via the re-derived project name; if a file is present but unparseable, print a warning (`malformed .pi-test-harness.json, derived project from CWD`) and continue. Teardown never blocks on a bad state file.

## 5. Playwright lifecycle reads the port

- [x] 5.1 In `tests/e2e/lifecycle.ts`, replace the literal `HEALTH_URL = http://localhost:18000` with a port-derived value. `USE_RUNNING`: `DASHBOARD_PORT = Number(process.env.PW_E2E_PORT ?? 18000)`. Managed: probe a free port in JS.
- [x] 5.2 Export `DASHBOARD_PORT` + `PI_GATEWAY_PORT` into the `test-up.sh` spawn env in `global-setup.ts` (the D1 override path) so the container binds exactly what Playwright probes.
- [x] 5.3 Export `HEALTH_URL` + `BASE_URL` from `lifecycle.ts`; import `BASE_URL` in `playwright.config.ts` for `use.baseURL` instead of the literal.

## 6. Tests

- [x] 6.1 `docker/__tests__/test-up-port-derivation.test.*` (or a bash test under `qa/`/`scripts/__tests__`): assert `is_free`/`find_free_port` pick an open port and skip a port held by a probe socket; assert the same `HOST_CWD` yields the same base offset twice (determinism); assert two different `HOST_CWD` values yield different project names.
- [x] 6.2 State-file shape test: run the derivation path with a temp `HOST_CWD`, assert `.pi-test-harness.json` parses and contains `project` + numeric `dashboardPort`/`gatewayPort` in the expected windows.
- [x] 6.3 compose-interpolation test (no Docker): `docker compose -f compose.yml -f compose.test.yml config` with `DASHBOARD_PORT=18042` exported → assert the rendered config publishes `18042:18042` AND sets container env `DASHBOARD_PORT=18042` (published port == listen port; catches a re-hardcode regression).
- [x] 6.4 Lint/no-Docker guard: skip-with-message when `docker` is absent so the unit leg stays green in CI without Docker.

## 7. Documentation

- [x] 7.1 Delegate to a general-purpose subagent (caveman style): update `docs/file-index-docker.md` rows for `test-up.sh`, `test-down.sh`, `compose.test.yml` to describe dynamic ports + `-p` project name + state file. Add a row for `.pi-test-harness.json`.
- [x] 7.2 Delegate (caveman style): update `docs/file-index-skills-misc.md` rows for `tests/e2e/lifecycle.ts` + `playwright.config.ts` (port now dynamic; `PW_E2E_PORT`).
- [x] 7.3 Update `docker/TESTING.md`: parallel-worktree section — how ports/project are derived, the state file, `PW_E2E_PORT`. Note `See change: parallelize-test-harness`.

## 8. Validate

- [x] 8.1 Two-worktree real run: `cd ../worktree-a && docker/test-up.sh -d`, then `cd ../worktree-b && docker/test-up.sh -d`. Assert both `/api/health` return 200 on their distinct ports; `docker compose ls` shows two distinct `pi-dash-test-*` projects.
- [x] 8.2 Selective teardown: `test-down.sh` from worktree A; assert A's containers gone, B's still up + reachable.
- [x] 8.3 Stable-port re-run: `test-up.sh` → `test-down.sh` → `test-up.sh` in the same worktree; assert identical port both times.
- [x] 8.4 e2e regression: `npm run test:e2e` (managed) passes end-to-end with the dynamic port; then `PW_E2E_USE_RUNNING=1 PW_E2E_PORT=<n> npm run test:e2e` against a hand-started instance.
- [x] 8.5 Host-clean check: after teardown, `git status` in each worktree shows no `.pi-test-harness.json` (gitignored) and no other tree changes.
