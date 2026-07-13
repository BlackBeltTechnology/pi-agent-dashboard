---
name: "run-dashboard-e2e-local-changes"
description: "Run Playwright E2E (tests/e2e/) against the docker/ all-in-one harness so it reflects LOCAL code changes, not a stale cached image."
version: 3
created: "2026-06-24"
updated: "2026-07-13"
---
## When to Use
Use when validating local dashboard changes via the Docker browser-E2E harness (npm run test:e2e), or when a new/edited E2E spec mysteriously fails to see your code. The harness's test-up.sh runs `docker compose up` WITHOUT `--build`, so it reuses a cached `pi-dashboard:local` image and your committed changes are NOT in the running container until you rebuild.

## Procedure
1. Rebuild the image from current source FIRST: `docker compose -f docker/compose.yml build` (Dockerfile COPYs packages/ + runs npm install && npm run build → bakes local source). Slow (~4-6 min: apt + npm install + build).
2. Run the suite (or one spec): `npm run test:e2e` or `npx playwright test <spec-name>`. Playwright globalSetup runs docker/test-up.sh (compose up, reuses the just-built image), waits for /api/health 200, runs specs at http://localhost:18000, globalTeardown runs test-down.sh (removes container+volumes+network).
3. Fast iteration after a build: `PW_E2E_USE_RUNNING=1 npm run test:e2e` attaches to an already-running harness and skips teardown.
4. Spec conventions: select existing app `data-testid`s (helpers/index.ts TESTIDS map for static keys; page.getByTestId(`...-${id}`) for dynamic). Navigate Settings→Packages via page.goto('/settings/packages') then wait for testid `package-browser`; RecommendedExtensions card renders inside it (non-collapsible Section).

## Pitfalls
- Under heavy host load (multiple worktree test containers + many pi sessions), the managed `npm run test:e2e` globalSetup can blow its 180s health cap even with a pre-built image. Robust fallback = manual up + attach mode for a SINGLE spec: (1) pre-build the per-worktree tag; (2) bring the container up yourself WITH the seed env `PI_E2E_SEED=1 PI_TEST_PEERS=both ./docker/test-up.sh -d` (writes `.pi-test-harness.json` with the derived port); (3) poll `curl :$PORT/api/health` until 200; (4) run `PW_E2E_USE_RUNNING=1 PW_E2E_PORT=$PORT PW_CHANNEL=chrome npx playwright test <spec>` (skips globalSetup build + teardown); (5) `./docker/test-down.sh` after.
- MANDATORY seed env on manual `test-up.sh`: without `PI_E2E_SEED=1` the onboarding "Add folder" CTA renders DISABLED (`title="Set up credentials first"`, gated on `providersReady`), so `spawnFreshGitSession`/`pinDirectory` time out at 60s. The managed globalSetup sets `PI_E2E_SEED=1` + `PI_TEST_PEERS=both`; a hand-rolled `test-up.sh -d` does NOT — pass them explicitly.
- Specs needing global roles/models data (e.g. `roles-custom.spec.ts` asserting `builtinRoleNames`-driven UI) MUST spawn a live session first: the client only sends `request_roles`/`request_models` through the first non-ended session (App.tsx), so with zero sessions the roles panel never receives `builtinRoleNames` and renders its flat back-compat layout.
## Verification
1. `docker compose -f docker/compose.yml build` ends with `Image pi-dashboard:local Built`.
2. `npm run test:e2e` prints `N passed` and the teardown removes the pi-dash-test-* container/volumes/network.
3. A spec asserting your new UI (e.g. recommended-requires) passes only after the rebuild, not before.