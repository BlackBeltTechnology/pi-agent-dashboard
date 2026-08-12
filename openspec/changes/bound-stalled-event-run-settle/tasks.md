# Tasks — bound-stalled-event-run-settle

## Tests (written first, verified RED)

- [x] 1.1 New `packages/automation-plugin/src/__tests__/event-run-stall-settles.test.ts`
  drives the real engine + real run-store with an injected clock and a registered
  event action that declares a completion.
- [x] 1.2 Scenario: a delivered event run with no observed activity is untouched at
  the undelivered bound, untouched inside the quiet bound, and reaped `error` +
  terminated just past it — strictly inside `maxRunAgeMs`, slot freed.
- [x] 1.3 Scenario: repeated `noteRunActivity` keeps a live event run `running`
  indefinitely, and it still settles `done` on its real completion.
- [x] 1.4 Scenario: a delivered PROMPT run is left alone past the quiet bound.
- [x] 1.5 RED captured before implementation (`running` != `error`;
  `noteRunActivity is not a function`).

## Implementation

- [x] 2.1 `EngineConfig.stalledRunTimeoutMs` (optional; `<= 0` disables).
- [x] 2.2 `RunContext.lastActivityAt`, seeded in both delivery paths
  (`onSessionRegistered`, `onSessionRegisteredForRun`).
- [x] 2.3 `Engine.noteRunActivity(sessionId)` — refresh the timestamp; no-op for
  an unknown session.
- [x] 2.4 `reapStalledEventRuns()` — delivered + declared-completion + quiet past
  the bound ⇒ `finishAndRelease` `error` + `terminate`; wired into
  `reapStaleRuns()` beside the undelivered pass.
- [x] 2.5 Named finalize log line `[finalize] path=stalled-reap`.
- [x] 2.6 Plugin config surface `stalledRunTimeoutMs` (default 120 s) threaded
  into the engine config.
- [x] 2.7 Call `engine.noteRunActivity(sessionId)` for every observed frame of a
  tracked run session in the plugin's `onEvent`.

## Validate

- [x] 3.1 New test file GREEN.
- [x] 3.2 Existing run-lifecycle suites still GREEN
  (`run-settles-promptly`, `flows-run-finalizes-on-forwarded-completion`,
  `engine`, `runner`) — the "delivered long-running run is left alone"
  guarantee is unchanged.
- [x] 3.3 Full repo suite run; no new failures vs the recorded baseline.
- [x] 3.4 `openspec validate bound-stalled-event-run-settle --strict`.

## Manual / QA (deferred)

- [ ] 4.1 Observe a `[finalize] path=stalled-reap` line in `server.log` against a
  deliberately superseded bridge.
