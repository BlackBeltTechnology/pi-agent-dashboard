# lifecycle.ts — index

Shared E2E lifecycle module. Port dynamic: probes free port in managed mode; `PW_E2E_PORT` (default 18000) + `PW_GATEWAY_PORT` when attaching (USE_RUNNING). Exports `DASHBOARD_PORT`, `PI_GATEWAY_PORT`, `BASE_URL`, `HEALTH_URL`. Paths `REPO_ROOT`/`DOCKER_DIR`/`TEST_UP`/`TEST_DOWN`, `MARKER_PATH` `test-results/.e2e-managed`, `USE_RUNNING` flag, `waitForHealth(timeout)` poll helper. See change: add-playwright-e2e. See change: parallelize-test-harness.
