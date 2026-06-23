# Browser E2E (Playwright)

Browser-level end-to-end QA. Drives a real Chromium against the **Docker test
harness** (`docker/`) on `http://localhost:18000` — an isolated, ephemeral
dashboard that cannot collide with a host dashboard and discards all state each
run.

This layer is **additive** to the VM smoke tests in `qa/` (clean-install +
process runtime across OSes) and to the `site/` Playwright pipeline (marketing
screenshots). It owns rendered-UI behaviour assertions.

## Prerequisites

- **Docker** (running) — the suite boots the `docker/` test container.
- **Chromium for Playwright** (one-time):

  ```bash
  npx playwright install chromium
  ```

  Browsers are NOT vendored; install them locally once.

## Run

```bash
npm run test:e2e        # boot container, run specs, tear down
npm run test:e2e:ui     # same, Playwright UI mode
```

Default (managed) lifecycle:

1. `globalSetup` spawns `docker/test-up.sh` from a throwaway workspace dir
   (keeps the overlay off the repo) and waits for `/api/health` → 200
   (up to 180s; first run builds the image).
2. specs run against `:18000`.
3. `globalTeardown` runs `docker/test-down.sh` (`compose down -v`) — all
   ephemeral state discarded, host `~/.pi` byte-identical.

A marker (`test-results/.e2e-managed`) records that setup booted the container
so teardown knows to tear it down even across a crash/retry.

## Fast path — attach to a running container

Skip boot/teardown and target a container you started yourself:

```bash
docker/test-up.sh                       # start once, leave running
PW_E2E_USE_RUNNING=1 npm run test:e2e   # attach, assert :18000 healthy, no teardown
```

`globalSetup` only verifies health; `globalTeardown` is a no-op. You own the
container lifecycle.

**Scenario specs need the seed flag in the fast path.** Specs that pin a folder
or spawn a session (e.g. `session-spawn.spec.ts`) require the onboarding gate
cleared and the network guard opened. Managed mode sets `PI_E2E_SEED=1`
automatically; for the fast path, boot the container with it yourself:

```bash
PI_E2E_SEED=1 docker/test-up.sh             # seed fake credential + trust
PW_E2E_USE_RUNNING=1 npm run test:e2e
```

`PI_E2E_SEED=1` makes `docker/test-entrypoint.sh` seed a fake (never-valid)
anthropic OAuth credential — flips `providersReady` so the LandingPage step
CTAs unlock — and seed `trustedNetworks` (RFC1918 private blocks) so the in-container
browser (docker-gateway source IP, non-loopback) clears the network guard for
directory listing / providers. A spawned session registers over the bridge
before any model call, so card-appearance does not depend on key validity.
Without the flag the harness stays UI-only and scenario specs fail at the pin
step.

## Layout

| Path | Purpose |
|------|---------|
| `playwright.config.ts` (repo root) | `testDir: tests/e2e`, `baseURL :18000`, chromium, global setup/teardown |
| `tests/e2e/global-setup.ts` | Boot container (or verify health in fast path), poll `/api/health` |
| `tests/e2e/global-teardown.ts` | Tear down when managed; no-op in fast path |
| `tests/e2e/lifecycle.ts` | Shared paths, health poll, marker, `PW_E2E_USE_RUNNING` |
| `tests/e2e/smoke.spec.ts` | Wiring proof: shell renders + no disconnect banner |
| `tests/e2e/session-spawn.spec.ts` | Scenario 5.1: pin git fixture → spawn → card appears (authoritative WS round-trip). Needs `PI_E2E_SEED=1`. |
| `tests/e2e/helpers/` | `gotoDashboard(page)` + testid→locator map |

## Conventions

- **Select on existing `data-testid`s** (693 already shipped) — never CSS
  classes, translated text, or DOM structure. The testid→locator map lives in
  `helpers/index.ts` so a renamed testid breaks in one place. Do NOT add app
  testids for E2E.
- **Fresh-container determinism**: the harness boots fixtures unpinned with
  ephemeral `~/.pi`. Any workspace-dependent spec must start with a pin-fixture
  arrange step and assume no pre-existing session/folder/VCS root.
- New browser-level scenarios go here as Playwright specs — NOT in
  `qa/tests/*.sh,*.ps1` (those stay CLI/process smoke).

## Not run by `npm test`

E2E is opt-in and needs Docker. `npm test` (vitest) does not pick up
`tests/e2e/` — it is outside every vitest project glob.
