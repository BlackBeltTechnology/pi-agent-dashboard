## Why

A work-source fire can correctly lease only the configured child bound while leaving additional work for later fires, but operators cannot distinguish “all available work leased” from “work deferred.” The existing `concurrency: queue` label also invites an incorrect intra-fire interpretation, while the parent/child run state needed to display batch progress is available only as an implicit REST shape.

## What Changes

- Make a work-source fire report how many available items were leased and how many remained unleased for a later fire.
- Pin the parent/child run-list REST contract needed to render “batch started, N running,” including the work-item key assigned to each child.
- Explicitly keep run-lifecycle WebSocket push out of scope; consumers poll the existing run-list route for state changes.
- Define `concurrency` as an inter-fire policy and `maxConcurrentSpawns` as the independent intra-fire work-source bound.
- Treat the existing plugin-config → environment → hard-default bound resolution as already satisfied; add no new configuration surface.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `automation-run-lifecycle`: Make deferred work observable, pin polling-visible parent/child state, and disambiguate inter-fire concurrency from intra-fire spawn width.

## Discipline Skills

`observability-instrumentation` (operator-visible deferred-work signal), `review-code` (non-trivial lifecycle contract before commit). No other discipline skill applies.

## Impact

- `packages/automation-plugin/src/server/engine.ts`: deferred-count observation when a work source returns a bounded lease.
- `packages/automation-plugin/src/server/run-store.ts`: parent/child state contract, per-child work-item attribution, and persisted deferred-work observation.
- `packages/automation-plugin/src/server/routes.ts`: stable run-list response shape for polling consumers.
- Automation-plugin tests: leased/deferred counts, parent/child running-state response with per-child work-item attribution, and inter-fire versus intra-fire concurrency semantics.
- Automation documentation: explain `concurrency` versus `maxConcurrentSpawns` and the polling-only lifecycle contract.
- No new endpoint, WebSocket event, configuration key, or runtime dependency.
