# Design

## Context

Playwright runs the test runner + Chromium on the host; the Docker harness only
serves the app at `http://localhost:<port>`. So browser availability is a
host concern, independent of the container. Two execution paths reach the
suite:

- **npm path** — `npm run test:e2e` / `test:e2e:ui`. npm honours `pre*` hooks.
- **direct path** — `npx playwright test`, `playwright test --ui`, IDE runners,
  `PW_E2E_USE_RUNNING=1 playwright test`. These bypass npm `pre*` hooks.

Both reach `globalSetup`, which today boots the container (≤180s) *before* the
browser is ever touched.

## Decision 1 — Auto-install vs fail-fast (the open question)

Use **both, split by path**:

| Path | Browser missing → behaviour | Rationale |
|------|------------------------------|-----------|
| npm (`pretest:e2e`) | **auto-install** `playwright install chromium` | The developer typed `npm run test:e2e`; installing the thing the command needs is the least-surprising outcome. Hook is a no-op when present. |
| direct / `globalSetup` preflight | **fail fast** with the exact command | A surprise multi-MB download mid-`playwright test` (especially in CI or `PW_E2E_USE_RUNNING`) is worse than an instant, actionable error. |

This gives the friendly self-heal on the common path without ever triggering a
silent network download on paths the npm hook can't see.

```
   npm run test:e2e
      └─ pretest:e2e → playwright install chromium  (no-op if present)
           └─ playwright test → globalSetup
                └─ preflight: browser present? ── yes ─▶ boot container ─▶ run
                                              └─ no ──▶ (can't happen via npm;
                                                        backstop for direct path)
   npx playwright test
      └─ globalSetup
           └─ preflight: browser present? ── no ──▶ FAIL FAST, print:
                                                    "npx playwright install chromium"
                                              └─ yes ─▶ boot container ─▶ run
```

## Decision 2 — Preflight ordering

The browser check MUST run **before** `test-up.sh` is spawned. Booting the
container first wastes up to 180s when the failure is a 1-command browser
install. Ordering: preflight → (USE_RUNNING health check | managed boot).

Implementation: import `chromium` from `@playwright/test`, resolve
`chromium.executablePath()`, and `fs.existsSync` it inside a try/catch. Missing
or throwing → fail fast with a message naming `npx playwright install chromium`
and referencing this change. No new dependency — `@playwright/test` is already
imported by the config.

## Decision 3 — Version pin

Pin `@playwright/test` to an exact version (drop `^`). Floating allowed a minor
bump (1.57→1.61) that silently changed the required Chromium revision and
forced a re-download. Exact pin makes the browser revision deterministic;
upgrades become an explicit, reviewed bump. Pin to the version already in
`package-lock.json` to avoid churn in this change.

## Out of scope

- Browser-in-container / pre-baked image (Linux render parity, offline CI). That
  flips `baseURL` off host-loopback onto the docker network and is a separate,
  larger change.
- Auto-repairing a missing `node_modules/.bin/playwright` symlink. The preflight
  invokes Playwright via the already-imported module (not the `.bin` shim), so a
  broken symlink no longer blocks the suite; repairing it is plain
  `npm install` hygiene, not in this change.
