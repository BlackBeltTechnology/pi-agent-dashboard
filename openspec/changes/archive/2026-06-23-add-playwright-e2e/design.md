# Design — add-playwright-e2e

## Selector strategy: ride the existing data-testids

`packages/client/src` already carries **693 `data-testid` attributes**. The E2E suite SHALL select on these, not on CSS classes, text copy (i18n-translated, brittle), or DOM structure. No new testids are added by this change.

Ready-made seams per backlog area:

| Area | Existing testids |
|---|---|
| landing / onboarding | `onboarding-step-1-done`, landing CTA testids |
| sessions | `session-card-desktop`, `session-search-input`, `current-session`, `session-status-icon` |
| vcs (git) | `git-init-btn`, `git-branch-btn`, `composer-git-group`, `git-source-switch-bundled`/`-host` |
| vcs (jj) | `composer-jj-group` |
| terminal | `terminal-card`, `open-inline-terminal-button` |
| openspec board | `openspec-board`, `board-card-name`, `board-card-state` |
| settings | `settings-btn`, `settings-content` |

`tests/e2e/helpers/` SHALL centralize a testid → locator map so a renamed testid breaks in one place.

## WS-connection proof: no positive DOM signal exists

`useWebSocket.ts` exposes `ConnectionStatus = connecting | connected | offline | auth_required`, but the **only** DOM render derived from it is the NEGATIVE case: `ConnectionStatusBanner` → `role="alert"` "Disconnected from …", shown only after status≠connected for >3s. There is no positive "connected" element.

Consequence: on a fresh container `sessions.size === 0` in BOTH `connecting` and `connected`, so "empty list renders" is NOT a connectivity proxy.

Decisions:

- **Smoke (`smoke.spec.ts`)** — light proof only: assert the shell/landing mounts AND the disconnect `role="alert"` banner does NOT appear within a short hold window (option A, negative-hold). No app change.
- **First real WS round-trip = scenario B (promoted to front of backlog).** Pin a baked fixture (`fixtures/sample-git`) → spawn a session → assert `session-card-desktop` appears. A card only appears via a live WS round-trip, so this is the authoritative connectivity test. Heavier than smoke, so it lives in the scenario suite, not `smoke.spec.ts`.
- **Deferred — option C (one `data-testid="ws-status"` + `data-status={status}` on the shell).** A 1-line app change giving a deterministic positive connected assertion. NOT done now. Revisit ONLY if option A proves flaky in practice (timing races on slow container boots). Recorded here so the option isn't rediscovered from scratch.

## Fresh-container determinism

The Docker harness boots with ephemeral `~/.pi` and baked-but-unpinned fixtures (`fixtures/sample-git`, `fixtures/sample-jj`). Any scenario needing a workspace (VCS panels, terminal-in-folder, spawn) SHALL begin with a **pin-fixture arrange step** (via the folder-pin / `git-init-btn` testids) — the container does not pin fixtures at boot. Specs SHALL NOT assume any pre-existing session, folder, or VCS root.
