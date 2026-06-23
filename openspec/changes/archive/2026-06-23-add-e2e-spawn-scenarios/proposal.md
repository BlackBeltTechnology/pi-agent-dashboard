# Author the spawn-dependent E2E scenarios + make the harness provider-ready

## Why

`add-playwright-e2e` (archived) landed the harness + smoke spec and left a
follow-up backlog (its tasks §5) of real scenario specs: §5.1 spawn round-trip,
§5.2 git panel, §5.4 terminal, §5.6 navigation. Authoring the first of those
exposed a precondition the archived design never anticipated:

- **The fresh container is gated.** `LandingPage` disables Add-folder /
  Start-session until `providersReady`. The test container is UI-only (no
  credentials), so the only path to the first pin — the onboarding step-2 CTA —
  never unlocks. Seeded api_keys do not count: `/api/provider-auth/status` only
  reports `authenticated:true` for OAuth credentials or providers present in a
  bridge-pushed catalogue (empty with no sessions → chicken-and-egg).
- **The in-container browser is non-loopback.** Its source IP is the docker
  gateway, so `createNetworkGuard` 403s the directory-listing endpoint
  (`/api/browse`) the pin dialog needs, plus `/api/providers`.

Both block every spawn-dependent scenario. The harness must be made
provider-ready before §5.1–§5.6 can run.

A second mismatch: §5.2 named `composer-git-group`, but that group renders only
for WORKTREE sessions (`showGit && session.gitWorktree`). A plain session in a
git repo is not a worktree, so the spec asserts the session-card branch
indicator (`git-branch-btn`) instead — equivalent "git status renders" proof.

## What Changes

- **Harness (gated behind `PI_E2E_SEED=1`, default off → manual QA stays
  UI-only):**
  - `docker/test-entrypoint.sh` seeds, before the base entrypoint, a fake
    never-valid `anthropic` OAuth credential into `auth.json` (flips
    `providersReady`) and `trustedNetworks` (RFC1918 private blocks) into
    `config.json` (in-container browser clears the network guard). Both no-op if
    the files exist, so the base `seed-auth.js` + config seed skip.
  - `docker/compose.test.yml` passes `PI_E2E_SEED` through to the container.
  - `tests/e2e/global-setup.ts` sets `PI_E2E_SEED=1` for managed runs and
    blanks host provider keys so they never leak into the disposable container.
- **Helpers (`tests/e2e/helpers/index.ts`):** `pinDirectory(page, path)` and
  `ensureGitSession(page)` (idempotent pin+spawn that reuses an existing card,
  since all specs share one container). New testids in the map.
- **Scenario specs:**
  - `tests/e2e/session-spawn.spec.ts` (§5.1) — refactored onto
    `ensureGitSession`; the card appearing is the authoritative WS round-trip.
  - `tests/e2e/git-panel.spec.ts` (§5.2) — asserts `git-branch-btn`.
  - `tests/e2e/terminal.spec.ts` (§5.4) — opens the inline terminal; asserts the
    xterm "Terminal input" textarea mounts.
  - `tests/e2e/navigation.spec.ts` (§5.6) — opens settings; asserts no uncaught
    `pageerror` (console noise is ignored — only crashes fail).
- **Docs:** `tests/e2e/README.md` fast-path note; file-index rows.

Out of scope (deferred): folder-scoped route coverage (openspec board / archive
/ specs — depend on per-folder openspec presence), jj panel §5.3, live-update
§5.5, CI leg §5.7, positive `ws-status` testid §5.8.

## Impact

- Affected specs: `playwright-e2e-qa`.
- Affected code: `docker/test-entrypoint.sh`, `docker/compose.test.yml`,
  `tests/e2e/*`. No production code changes; harness seed is test-only and
  gated. The RFC1918 trust never leaves the disposable, RAM-backed,
  localhost-published test container.
