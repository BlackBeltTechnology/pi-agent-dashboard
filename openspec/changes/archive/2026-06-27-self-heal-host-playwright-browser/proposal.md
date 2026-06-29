# Make host Playwright E2E runs self-healing

## Why

Running the browser-E2E suite (`tests/e2e/`) on a host machine has four avoidable friction points. The Docker harness only hosts the *app under test*; Playwright still drives a real Chromium **on the host**, so all four bite locally:

1. **Hidden one-time prerequisite.** `tests/e2e/README.md` documents `npx playwright install chromium` as a manual prereq. Forget it and `npm run test:e2e` first boots the Docker container (`globalSetup` waits up to **180s**, building the image on a cold run), *then* dies at browser launch with a generic Playwright "executable doesn't exist" error. The cheapest-to-fix mistake costs the most time to discover.
2. **No browser preflight.** `globalSetup` verifies container health but never checks the browser, so the failure surfaces *after* the expensive container boot instead of before it.
3. **Floating version → surprise re-downloads.** Root `@playwright/test` is pinned `^1.57.0`, which floats (currently resolves to 1.61.1). Each transitive bump changes the required Chromium revision (1.57→r1200, 1.61→r1228), forcing a fresh multi-MB browser download the developer didn't ask for.
4. **Broken bin link is invisible.** When `node_modules/.bin/playwright` is missing (partial / `--no-bin-links` install), `npx playwright install` falls through to a registry fetch and fails with a misleading "cannot download playwright" — the message blames the network when the cause is a missing symlink.

Net effect: the first host run is a 3-minute wait that ends in a cryptic error, and version drift re-triggers downloads. This change makes the normal path self-heal and the slow path fail fast.

## What Changes

- **Auto-install the browser on the npm path.** Add a `pretest:e2e` (and `pretest:e2e:ui`) script that runs `playwright install chromium`. No-op (~1s probe) when already present; on a fresh host it installs the matching revision before the suite runs — the manual prereq disappears.
- **Browser preflight in `globalSetup`, ordered BEFORE the Docker boot.** Check the Chromium executable exists first. If missing, fail fast (sub-second) with the exact remediation command — never pay the ≤180s container boot only to die at browser launch. This backstops the slow paths (`test:e2e:ui`, raw `playwright test`) that bypass the npm `pre*` hook.
- **Pin `@playwright/test` to an exact version** (drop the `^`) so the required browser revision is stable and transitive bumps stop triggering surprise re-downloads.
- **README + file-index updates.** Document the self-heal behaviour; demote the manual `npx playwright install chromium` step to a fallback note. Add/refresh the matching `docs/file-index-*` rows (delegated, caveman style).
- **No application code changes.** Test infrastructure only — container image, server, and bridge are untouched.

## Capabilities

### Modified Capabilities

- `playwright-e2e-qa`: add a browser-availability preflight ordered before container boot, an npm-path auto-install hook, and an exact-version pin. Existing harness, lifecycle, and smoke-spec requirements are unchanged.

## Impact

- **Scope**: `package.json` (pin + two `pre*` scripts), `tests/e2e/global-setup.ts` (preflight before boot), `tests/e2e/README.md` (prereq → self-heal note), one `docs/file-index-*` row. ~30 LOC, no deps.
- **Depends on**: archived `add-playwright-e2e` (the suite this refines). No new dependency, no image rebuild.
- **Runtime cost**: the npm path gains a ~1s "browser present?" probe per run (no-op when installed); the preflight adds the same sub-second check to the slow paths. Net time *saved* on the common first-run-mistake case: up to ~180s (the wasted container boot is skipped).
- **Behaviour change**: on a host missing the browser, `npm run test:e2e` now installs it (a one-time multi-MB download) instead of failing. The download is surfaced in the design decision below (auto-install on npm path, fail-fast everywhere else).
- **Non-goals**:
  - Moving the browser into a container / pre-baked image (the Linux-parity, offline-CI route) — separate, larger change.
  - CI wiring — still out of scope, as in the original suite.
  - Vendoring browser binaries into the repo.
  - Touching the Docker harness lifecycle, ports, or seeding.
