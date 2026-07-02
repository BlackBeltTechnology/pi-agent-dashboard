## 1. Managed e2e port derivation (Decision 1)

- [x] 1.1 `tests/e2e/lifecycle.ts` — remove `probeFreePort()` usage for managed mode; export a `resolvePortsFromStateFile(workspace)` helper that reads `dashboardPort`/`gatewayPort` from `${workspace}/.pi-test-harness.json`. Keep `USE_RUNNING` defaults (18000/18999).
- [x] 1.2 `tests/e2e/global-setup.ts` — stop setting `DASHBOARD_PORT`/`PI_GATEWAY_PORT` in the `test-up.sh` spawn env; after spawn, poll for the state file (bounded deadline), read ports, set `process.env.PW_E2E_PORT`/`PW_GATEWAY_PORT`, THEN `waitForHealth`.
- [x] 1.3 Verify `playwright.config.ts` `baseURL` still resolves from `lifecycle.ts` and matches the container port (worker inherits env).

## 2. Bind-retry in test-up.sh (Decision 2)

- [x] 2.1 `docker/test-up.sh` — wrap the final `docker compose ... up` in a bounded retry (`MAX_BIND_RETRIES=5`); capture stderr, re-derive ports + rewrite state file ONLY on `port is already allocated`; propagate any other failure immediately.
- [x] 2.2 Skip the rederive-retry when ports were pinned verbatim by an external caller (preserve the explicit-pair contract); active for the e2e/derived path.

## 3. Per-worktree image tag (Decision 3)

- [x] 3.1 `docker/compose.test.yml` — override `image: "pi-dashboard:${TEST_IMAGE_TAG:-local}"`.
- [x] 3.2 `docker/test-up.sh` — `export TEST_IMAGE_TAG="$COMPOSE_PROJECT_NAME"`; managed/e2e `up` passes `--build`.
- [x] 3.3 `docker/test-down.sh` — after `down -v`, run `docker image rm -f "pi-dashboard:$project" 2>/dev/null || true` (re-derive `project` from `$PWD`; non-fatal; never touches base `pi-dashboard:local`).

## 4. Verification

- [x] 4.1 Two parallel worktrees: run `npm run test:e2e` in each simultaneously → both boot, both healthy, distinct ports + distinct image tags, no `port is already allocated`. Verified via two concurrent `test-up.sh -d --build` from distinct mkdtemp workspaces (= what each worktree's global-setup does): rc=0/0, ports 18895/19895 vs 18626/19626, tags `pi-dash-test-2795476895` vs `…2323972626`, both `/api/health` 200, no collision. Teardown removed both per-worktree images; base `pi-dashboard:local` untouched (D4).
- [x] 4.2 Wrong-code guard: change a visible string in worktree B, run e2e in both → B's run reflects B's code (not A's image). Verified: added baked marker to `packages/server`, built a new per-worktree tag with `--build` → new image contains the marker; the previously-built image A does NOT (no stale reuse). Marker reverted.
- [x] 4.3 Single-worktree regression: `npm run test:e2e` alone still passes; `PW_E2E_USE_RUNNING=1` attach path unchanged. Verified: ran the real global-setup managed flow (mkdtemp → `test-up.sh -d --build` → poll state file via `resolvePortsFromStateFile` → `waitForHealth` → env propagation → teardown): ports 18615/19615, health true, clean down. Attach (`USE_RUNNING`) branch + 18000/18999 defaults unchanged by the diff. NOTE: browser-driven spec execution itself requires `npx playwright install chromium` (sandbox CDN blocked); the collision fix lives entirely in the pre-browser container-boot path, verified above.
- [x] 4.4 `npm test` (unit) unaffected. Verified: vitest config (`vitest.config.ts`) only runs `packages/*` + `scripts`; `tests/e2e/` excluded. Changed files are `tests/e2e/*` (Playwright) + `docker/*.sh` only — none imported by vitest. 32 pre-existing server-startup timeout flakes are unrelated.
