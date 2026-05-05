## Why

When `spawnPiSession` fails, the user gets a single message string and very little signal about *what* broke or *why*. The OS process may be alive past the 300 ms crash window yet never `session_register` (wrong port, missing extension, version skew). On Windows headless, pi's stderr is captured to `~/.pi/dashboard/sessions/pi-spawn-*.log` but never tailed back to the UI. There's no preflight (a typo in `cwd`, missing pi binary, or unwritable directory races the spawn). And failures evaporate after the toast — no history to grep when a user reports "spawning sometimes fails".

This change adds five complementary diagnostics so a failed spawn produces an actionable, classified, debuggable signal instead of a one-liner.

## What Changes

- **Tail per-session stderr log on Windows headless failure**: when `waitForNoCrash` reports `!ok`, read the last 4 KB of the `pi-spawn-<ts>-<rand>.log` file and include it in `SpawnResult.stderr`. Bridge handler already forwards `stderr` on `spawn_error`; this populates it for the headless-Windows path that currently leaves it empty.
- **Classify failure causes** in `SpawnResult.code`: `"DIR_MISSING" | "PI_NOT_FOUND" | "WIN_PI_CMD_ONLY" | "WT_MISSING" | "TMUX_MISSING" | "PI_CRASHED" | "SPAWN_ERRNO" | "REGISTER_TIMEOUT" | "PREFLIGHT_FAILED"`. UI maps codes to actionable hints (open wizard, rescan tools, fix permissions) instead of regexing message strings.
- **Bridge `session_register` watchdog** (default 30 s, configurable via new `spawnRegisterTimeoutMs` config field exposed in Settings; range 5000–120000): if the spawned session never produces `session_register`, emit a new `spawn_register_timeout` browser event with `{ cwd, pid?, stderrTail }`. For headless spawns the watch is keyed by PID; for tmux/wt/wsl-tmux it is keyed by `cwd` (any `session_register` from that directory clears it). Late registrations after a fired timeout emit a follow-up `spawn_register_recovered` event so the UI can auto-clear the banner.
- **Preflight check on click**: before invoking `spawnPiSession`, run a fast subset of doctor (pi resolved? node resolved? cwd exists + writable?) using a `useLoginShell: false` resolver to avoid spawning a login shell on the click hot path. Refuse with `code: "PREFLIGHT_FAILED"` + structured reasons rather than racing the spawn.
- **Persist failures**: append every failed spawn (timestamp, cwd, strategy, code, message, stderrTail) to a rolling `~/.pi/dashboard/sessions/spawn-failures.log` (10 MB cap, single rotation to `.log.1`; co-located with per-session `pi-spawn-*.log` captures). Settings → Tools surfaces the last N entries via a new `GET /api/spawn-failures?limit=N`. Endpoint relies on the existing Fastify auth plugin; absence of auth on default local installs (and `cwd`-path leakage) flagged in README.md security section and queued in `docs/todo.md` for hardening.

No breaking API changes — new fields are additive. `SpawnResult.code` is optional, browser protocol gains additive `spawn_register_timeout` and `spawn_register_recovered` messages plus optional `code`/`reasons`/`stderr` fields on `spawn_error`.

## Capabilities

### New Capabilities
- `spawn-failure-log`: rolling persistence of failed pi-session spawn attempts under `~/.pi/dashboard/spawn-failures.log`, with a read API for UI display.
- `spawn-preflight`: synchronous validation gate (binary resolution, cwd existence/writability) run before any `spawnPiSession` invocation; returns structured failure reasons.
- `spawn-register-watchdog`: server-side timer that tracks every spawned PID until `session_register` arrives or 10 s elapses; emits `spawn_register_timeout` on timeout.

### Modified Capabilities
- `process-manager`: `SpawnResult` gains optional `code` (failure classifier) and `stderr` (tail of per-session log) fields. Every existing failure path SHALL set `code`. Windows headless failure path SHALL populate `stderr` from the per-session log.
- `headless-spawn`: Windows-headless failure handler SHALL read last 4 KB of `pi-spawn-*.log` after `waitForNoCrash` reports immediate exit and include it in the returned `SpawnResult.stderr`. The `logPath` SHALL also be returned on success for watchdog handoff.
- `spawn-error-persistence`: UI banner SHALL render the new `code` as an actionable hint (per-code copy + optional CTA) and SHALL render the `stderr` tail in a collapsed `<details>` block. New `spawn_register_timeout` event SHALL show a distinct banner. New `spawn_register_recovered` event SHALL auto-clear that banner.
- `dashboard-server`: register `GET /api/spawn-failures?limit=N` returning the last N parsed entries from the rolling log; protocol gains additive timeout + recovered messages.
- `shared-config`: add `spawnRegisterTimeoutMs` field (default 30000, clamped 5000–120000).
- `settings-panel`: add Settings UI input for `spawnRegisterTimeoutMs` with validation.

## Impact

Affected code:
- `packages/server/src/process-manager.ts` — add `code` + `stderr` + `logPath` on failure/success returns; tail per-session log on Windows headless crash.
- `packages/server/src/browser-handlers/session-action-handler.ts` — call preflight (login-shell-disabled resolver) before spawn; arm watchdog after every successful spawn; forward `code`/`stderr`/`reasons` on `spawn_error`.
- `packages/server/src/spawn-preflight.ts` (new) — pure validation function returning `{ ok, reasons }`.
- `packages/server/src/spawn-register-watchdog.ts` (new) — dual `byPid`/`byCwd` maps + `recentlyFired` TTL map; clear hooks in `pi-gateway.ts`.
- `packages/server/src/spawn-failure-log.ts` (new) — append + rotate + parse rolling log under `sessions/`.
- `packages/server/src/routes/system-routes.ts` — `GET /api/spawn-failures?limit=N`.
- `packages/shared/src/config.ts` — add `spawnRegisterTimeoutMs` field with clamp.
- `packages/shared/src/browser-protocol.ts` — add `spawn_register_timeout` + `spawn_register_recovered` messages; add optional `code`, `reasons`, `stderr` to `spawn_error`.
- `packages/client/src/components/SettingsPanel.tsx` — expose `spawnRegisterTimeoutMs` field.
- `packages/client/src/components/SpawnErrorBanner.tsx` (or equivalent) — render `code` hint + `<details>` stderr; handle timeout + recovered messages.
- `packages/client/src/components/ToolsSection.tsx` — surface last-N spawn failures.
- `README.md` — add note about spawn-failures endpoint auth posture in security section.
- `docs/todo.md` (new) — queue Unix-headless stderr capture and per-endpoint auth-required hardening.

No new dependencies. No protocol breaking changes (additive fields). Tests: pure-function tests for preflight, log rotation/parse, watchdog clear semantics; integration test for Windows-headless stderr tailing (mocked log file).
