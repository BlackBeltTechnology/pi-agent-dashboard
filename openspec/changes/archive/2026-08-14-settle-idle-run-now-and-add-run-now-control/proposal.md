## Why

Two automation defects remain after the per-invoice fan-out work:

1. **Manual run-now on an empty queue issues no run id (regression).** After
   `run-now-fans-out-per-invoice`, a run-now on a `scope: per-invoice` automation
   with an EMPTY queue returns `{ ok: true }` with no `runId`. But run-now is a
   manual operator action — clicking Run-now must always start a run that
   settles. The regression breaks the contract "the runner must issue a run id":
   a freshly-reset (empty) intake automation returns no id, so nothing settles.
   The scheduler fan-out correctly skips an empty queue (a periodic tick with
   nothing to do should stay silent) — but the manual path must not.

2. **No run-now control on the automation row.** The automation row exposes only
   an on/off (enable/disable) affordance under a stable, test-addressable hook.
   An operator cannot trigger a run from the row via a stable
   `automation-run-now` control, so a run-now cannot be driven from the row UI.

## What Changes

- **Idle settling run-now on an empty queue (server).** `engine.runNow` for a
  `scope: per-invoice` automation with an empty queue now starts ONE idle run
  (no invoice bound) that settles promptly, returning its `runId`, instead of a
  silent no-op. Two consecutive idle run-nows each return a DISTINCT `runId`. The
  scheduler fan-out (`dispatchFire`) still skips an empty queue, unchanged. A
  non-empty queue still fans out one run per queued invoice; a missing enumerator
  still fails.
- **Run-now control on the automation row (client).** The automation row
  (`AutomationBoard.tsx` card) carries the class `auto-row` and exposes a
  visible, enabled run-now button with the stable `data-testid="automation-run-now"`
  that fires the run-now API (existing `runAutomationNow`) and refreshes. The
  existing enable/disable control is unchanged. Invalid and running cards do not
  offer run-now (running shows Stop), as before.

## Impact

- Affected specs: `automation-per-invoice-fanout` (manual run-now settles on an
  empty queue), `automation-run-lifecycle` (row run-now control).
- Affected code: `packages/automation-plugin/src/server/engine.ts`
  (`runNow` empty-queue → idle settling run);
  `packages/automation-plugin/src/client/AutomationBoard.tsx` (`auto-row` class +
  stable `automation-run-now` testid on the run-now button).
- Behaviour: a run-now on an empty per-invoice automation now yields a settling
  run id; the row offers a stable run-now button beside the on/off control.

## Discipline Skills

- `review-code` — small but contract-affecting change across the engine and the
  board UI; review before commit.
