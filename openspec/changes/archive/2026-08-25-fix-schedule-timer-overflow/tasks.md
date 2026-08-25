# Tasks

## 1. Red tests (reproduce the bug first)

- [x] 1.1 In `scheduler.test.ts` (or `schedule-trigger` unit), add a fake-timer test:
  arm a `schedule` automation whose next fire is **> 24.855 days** away (e.g. a
  yearly `0 0 1 1 *`, or a synthetic cron). Assert with the **current** code it
  either fires far too early or fires more than once within a short advance — i.e.
  the test is RED, capturing the overflow/loop.
- [x] 1.2 Add a late-arrival test: arm a long delay, advance the fake clock **past
  the target** in one jump (simulating suspend across the target while the process
  lives), assert exactly **one** fire, at delay 0 — RED with a naive implementation.

## 2. Fix

- [x] 2.1 Decide fix location: **shared `setTimer` in `scheduler.ts`** (preferred —
  protects every future trigger kind) vs. narrow to `schedule-trigger.ts`. Record
  the choice in a one-line code comment referencing this change.
- [x] 2.2 Implement the chunked long-timeout: `MAX_DELAY = 2_147_483_647`. When the
  remaining wait exceeds `MAX_DELAY`, sleep `MAX_DELAY`, then on wake **recompute
  remaining against the absolute target instant** (`target − now()`) and re-arm;
  when remaining `≤ MAX_DELAY`, arm the final `setTimeout(fire, max(0, remaining))`.
  Preserve `unref()` so the timer never holds the process open.
- [x] 2.3 Ensure the returned `Disposable.clear()` clears whichever hop is currently
  pending (no leaked inner timer after dispose mid-hop).

## 3. Verify

- [x] 3.1 Tests from §1 now GREEN: long-delay cron fires **once** at the intended
  occurrence; no immediate-fire storm; late-arrival fires once at delay 0.
- [x] 3.2 Existing short-cadence scheduler tests still pass (no regression on
  ≤ 24.8-day delays — the common path).
- [x] 3.3 Confirm restart-skip is unchanged: a fresh `arm()` at `now` past a due
  occurrence returns the **next** future fire via `nextFire`, does not backfill.
- [x] 3.4 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then grep the
  summary; automation-plugin suite green.

## 4. Rebuild

- [x] 4.1 Server-side plugin change → `curl -X POST http://localhost:8000/api/restart`
  (jiti, no build). Confirm `/api/health` mode, then arm a short test cron to smoke
  the live path.

## 5. Spec

- [x] 5.1 Add the "Armed timer honors delays beyond the 32-bit ceiling" requirement
  to `automation-trigger-registry`, with scenarios for the long-delay fire, the
  late-arrival single fire, and a restated (unchanged) restart-skip.
