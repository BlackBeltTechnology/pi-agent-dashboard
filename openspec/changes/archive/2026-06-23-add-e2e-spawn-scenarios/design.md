# Design — add-e2e-spawn-scenarios

## The onboarding gate (root obstacle)

`LandingPage` (packages/client/src/components/LandingPage.tsx) derives three
steps:

- `step1 = providersReady ? "done" : "pending"`
- `step2` locked until `providersReady`; CTA `onboarding-step-2-cta` → open pin dialog
- `step3` locked until `pinnedCount > 0`; CTA `onboarding-step-3-cta` → spawn

On a fresh container the sidebar collapses to "No active sessions" — the sidebar
`dashboard-add-folder-btn` only renders once a folder/session/workspace exists
(`SessionList.tsx`). So the ONLY path to the first pin is the onboarding step-2
CTA, gated on `providersReady`.

`providersReady` (hooks/useProvidersReady.ts) counts:
1. `/api/providers` entries with a non-empty `apiKey` (OpenAI-style custom providers).
2. `/api/provider-auth/status` entries with `authenticated === true`.

The UI-only container has neither. Seeded api_keys in `auth.json` do NOT count:
`_buildAuthStatus` (provider-auth-storage.ts) marks api_key rows authenticated
only when the provider is in the bridge-pushed catalogue — empty until a session
connects. Chicken-and-egg.

## Decision 1 — fake OAuth credential clears the gate

`auth.json` `{"anthropic":{"type":"oauth",...}}` makes
`/api/provider-auth/status` report `anthropic` `authenticated:true` (OAuth row
from the local handler registry, no catalogue needed) → `providersReady` true.
Never valid; a spawned session registers over the bridge BEFORE any model call,
so card-appearance is independent of credential validity. Verified live.

## Decision 2 — open the network guard for the in-container browser

`createNetworkGuard` (localhost-guard.ts) allows loopback, trusted networks, or
authenticated requests. The browser reaches the container via the published
port; the in-container source IP is the docker gateway (non-loopback) → 403 on
`/api/browse` (the pin dialog's directory listing) and `/api/providers`.

Seed `trustedNetworks` with the RFC1918 private blocks (`10.0.0.0/8`,
`172.16.0.0/12`, `192.168.0.0/16`) — the SOURCE config field; the derived
`resolvedTrustedNetworks` is recomputed at load and ignored —
`parseTrustedNetworks` + the merge in shared/config.ts). Docker published-port
traffic is SNAT'd through the bridge gateway (Linux `172.17.x`, Docker Desktop
`192.168.65.x`), so the in-container browser's source IP is always private and
`matchCidr` clears it. Narrower than `0.0.0.0/0`; the trust never leaves a
disposable, RAM-backed, localhost-published test container.

## Decision 3 — seed at entrypoint, gated, before the base entrypoint

`pi-dashboard restart` inside the container kills PID 1 (it waits on the server
pid) → container exits. So config must be in place BEFORE the server starts.
`test-entrypoint.sh` seeds both files when `PI_E2E_SEED=1`, before calling the
base `entrypoint.sh`; `seed-auth.js` + the base config seed both skip because
the files already exist. Default-off keeps manual `docker/test-up.sh` UI-only.

## Decision 4 — §5.2 asserts git-branch-btn, not composer-git-group

`composer-git-group` renders only for worktree sessions
(`showGit && session.gitWorktree`, ComposerSessionActions.tsx). A plain session
in a git repo is not a worktree. `git-branch-btn` (SessionCard.tsx) renders once
the bridge reports `session.gitBranch` — i.e. git status was read from the repo.
That is the equivalent "git VCS renders" proof for a non-worktree session.

## Decision 5 — specs share one container; helpers are idempotent

Playwright tears the container down once per run, not per test, so state
accumulates and file order matters (alphabetical: git-panel, navigation,
session-spawn, smoke, terminal). `ensureGitSession` therefore reuses a visible
card (bounded 4s wait, not an instant check that races hydration) and only
pins+spawns when none exists. Each spawn-dependent spec calls it, so any spec
can run first.

## Decision 6 — selector choices

- Terminal: xterm exposes no testid. It mounts a hidden textarea
  `aria-label="Terminal input"`; asserting that textbox proves the pane
  initialized over the terminal WS. More robust than the `.xterm` class or a
  `terminal-card` testid (the inline card differs from the Terminals view).
- Navigation: assert no uncaught `pageerror` (thrown exceptions / unhandled
  rejections), NOT `console.error`. A SPA emits benign console errors (asset
  404s, MIME warnings on lazy chunks, the fake credential's model call failing);
  only a crash should fail the spec.
