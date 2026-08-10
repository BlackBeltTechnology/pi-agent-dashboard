# global-teardown.ts — index

Playwright globalTeardown. Managed (marker present, not fast path) → run `docker/test-down.sh` with cwd=managed workspace (from marker) so project re-derives, remove marker. `PW_E2E_USE_RUNNING=1` → no-op. See change: add-playwright-e2e. See change: parallelize-test-harness.
