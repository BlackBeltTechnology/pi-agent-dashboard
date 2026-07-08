# Tasks — finalize automation runs on session death

## 1. Session-death finalize (fix A, primary)
- [x] 1.1 Identify the gateway/heartbeat seam that logs `connection closed` and
      `heartbeat timeout … grace period`, and expose a no-reconnect close signal
      for `kind="automation"` sessions (see `bridge-heartbeat-watchdog`).
      → seam = `sessionManager.unregister` → `onUnregister` fan-out to new
      `ctx.onSessionEnded(cb)`; gateway `ws.on("close")` unregisters automation
      sessions immediately.
- [x] 1.2 In `engine.ts`, add an `onSessionDeath(sessionId)` (or route the close
      into `findBySession` → `finishAndRelease`) that finalizes a tracked run
      whose session died before a terminal event.
- [x] 1.3 Result capture: use buffered assistant/flow result if present; else
      finalize `status: error`, reason `session ended before completion`.
- [x] 1.4 Suppress the reconnect-grace path for headless `kind="automation"`
      sessions so they finalize immediately on close instead of waiting.
- [x] 1.5 Ensure idempotency with the existing `flow_complete` / `agent_end` /
      Stop paths (finalize exactly once; later signals are no-ops).

## 2. Stale-run reaper (fix B, backstop)
- [x] 2.1 Add a configurable max-run-age ceiling (setting + sane default).
      → `AutomationPluginConfig.maxRunAgeMs` / `EngineConfig.maxRunAgeMs`,
      default 30 min, `<= 0` disables.
- [x] 2.2 In `run-store.ts` / engine, sweep `running` runs past the ceiling on a
      timer and/or on each fire for the key: transition to `error` +
      `runner.completeRun(key)`.
      → `run-store.listStaleRunningRuns` + `engine.reapStaleRuns()` on a 60s
      timer (also callable directly).
- [x] 2.3 Make reaping idempotent with all finalize paths.

## 3. Tests
- [x] 3.1 Unit: code-only headless run whose session closes before
      `flow_complete` → finalized once, slot freed (regression for the proven
      `invoicebot:pull` wedge). → engine.test.ts "3.1/3.5" + "3.1 buffered".
- [x] 3.2 Unit: forwarded completion / `agent_end` after session-death finalize
      → no-op. → engine.test.ts "3.2".
- [x] 3.3 Unit: non-automation session close within grace window → grace path
      unchanged, no finalize. → server/__tests__/automation-session-close.test.ts.
- [x] 3.4 Unit: overdue `running` run reaped to `error` + slot freed; healthy
      in-progress run untouched; terminal signal after reap is a no-op.
      → engine.test.ts "3.4".
- [x] 3.5 Concurrency regression: with `concurrency: skip`, a lost terminal event
      no longer blocks subsequent fires once A (and/or B) finalizes the run.
      → engine.test.ts "3.1/3.5".

## 4. Migration / cleanup
- [x] 4.1 Confirm the reaper clears pre-existing `status: "running"` orphans on
      first sweep; document a one-time manual sweep as the alternative.
      → engine.test.ts "4.1: reaper clears a pre-existing on-disk running
      orphan"; manual-sweep alternative noted in proposal Impact + README.

## 5. Docs
- [x] 5.1 Note the code-only `flows.run` + `concurrency: skip` amplifier and the
      `queue`/`parallel` operator mitigation (fix D) in the automation docs.
      → packages/automation-plugin/README.md "Run finalization + concurrency".
