## Why

pi 1.6 settles its own credential writes (rotated OAuth single-use refresh tokens) on exit; the dashboard **server** does not. A server exit can cut off a credential write that started after any snapshot-style settle. `update-pi-core-1-6-adopt-apis` design D4 drafted a one-shot `settleCredentialWrites()` and rejected it in review; this change is the correct follow-up.

## What Changes

- Add an **exit barrier** in the server that stops new auth work and waits for in-flight credential writes before any exit path completes, rather than settling a snapshot (`runtime-credentials.js:44-45`).
- Route every server exit through it: idle-timer `stop()` (`packages/server/src/server.ts`), `POST /api/shutdown` and `POST /api/restart` (`routes/system-routes.ts`), the Electron restart branch (`system-routes.ts:1660-1663`), and the SIGTERM/SIGINT handlers (`cli.ts:400-409`, `lifecycle/home-lock-release.ts:46-62`, which race and must be ordered).
- Fit the barrier inside the callers' budgets: CLI 5 s (`cli.ts:717`), Electron 3 s (`electron/src/lib/server-lifecycle.ts:598`), restart SIGKILL after 3 s (`spawn-process/restart-helper.ts:193-198`).

## Capabilities

### Modified Capabilities

- `provider-auth-server`: credential writes settle before server exit.

## Impact

- `packages/server/src/` (server.ts, cli.ts, routes/system-routes.ts, lifecycle/), `packages/electron/src/lib/server-lifecycle.ts`.
- Compatibility: no wire/API change. Rollback: remove the barrier; exit paths revert to today's behaviour.

## Discipline Skills

- `doubt-driven-review` — exit-path ordering across competing SIGTERM listeners is easy to get subtly wrong.
- `security-hardening` — protects single-use refresh tokens from loss on exit.
- `systematic-debugging` — the existing exit races must be reproduced before the barrier is trusted.

Stub scaffolded by `update-pi-core-1-6-adopt-apis` (task 6.2, design D4); design and specs to follow via `plan-proposal`.
