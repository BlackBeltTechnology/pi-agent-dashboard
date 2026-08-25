# Fix schedule-trigger setTimeout 32-bit overflow

## Why

The `schedule` trigger arms a self-rescheduling one-shot timer whose delay is the
gap to the next cron occurrence:

```
// packages/automation-plugin/src/server/schedule-trigger.ts
const next = nextFire(cfg.cron, now);
const delay = Math.max(0, next.getTime() - deps.now());
timer = deps.setTimer(() => { fire(...); schedule(); }, delay);
```

The default `setTimer` in `scheduler.ts` is a bare `setTimeout(fn, ms)` with **no
clamping**. Node's `setTimeout` delay is a **32-bit signed int — max
`2^31 − 1 ms ≈ 24.855 days`**. Any longer delay does not wait: Node emits
`TimeoutOverflowWarning` and **clamps the delay to `1 ms`**, firing almost
immediately. Because the timer re-arms on fire (recomputing the same too-large
delay), the automation enters a **runaway loop firing ~1000×/sec**, each fire
carrying a `firedAt` timestamp far in the future.

`nextFire` scans a 4-year horizon and happily returns occurrences months or years
out, so **every cron whose gap exceeds ~24.8 days is affected** — monthly
(`0 0 1 * *`), quarterly (`0 0 1 */3 *`), and yearly (`0 0 1 1 *`) all overflow.
A user setting a "run on the 1st of each month" automation gets an immediate
firing storm instead of a monthly run.

This is a latent defect in the phase-1 scheduler shipped by `add-automation-plugin`,
whose design assumed short human cadences (Codex-style "weekday 9am") and never
addressed the 32-bit ceiling.

## What Changes

- **FIX** the shared timer seam so a delay longer than the 32-bit `setTimeout`
  ceiling is honored instead of overflowing. Implement a **chunked long-timeout**:
  when the remaining wait exceeds `MAX_DELAY (2^31 − 1)`, sleep `MAX_DELAY`, then
  on wake **recompute the remaining wait against the absolute target instant** and
  re-arm — repeating until the true fire time, then fire once. Recompute-to-target
  (not naive `delay − MAX` subtraction) keeps the timer self-correcting across long
  hops, GC pauses, and OS suspend/resume.
- **LATE-ARRIVAL SEMANTICS (in-process):** if a hop wakes at or after the target
  (e.g. the machine was suspended across the target while the process stayed
  alive), the recomputed remaining wait is `≤ 0`, so the timer fires **once,
  immediately**. This is correct for an occurrence still "owed" within the living
  process's lifetime.
- **PRESERVE restart-skip (unchanged):** the chunked timer lives only in process
  memory. On a full server/PC restart the timer is gone; arming recomputes
  `nextFire(cron, now)` strictly forward, so a fire missed while the process was
  **not running** is still **skipped, never backfilled** — exactly the existing
  `automation-trigger-registry` "Restart catch-up is skip" requirement. This change
  does not alter that decision.

Where the fix lands: the **default `setTimer` in `scheduler.ts`** (the shared arm
seam), so every current and future trigger `kind` armed through the registry
inherits overflow safety — not just `schedule`. The `deps.setTimer` injection seam
(already used by tests with a fake timer) is preserved, so `arm(cfg, fire, deps)`
contracts and the test harness shape are untouched.

Out of scope:
- **Durable long-horizon schedules across shutdown.** Making a monthly/yearly cron
  fire reliably when the box is powered off at the target minute requires persisting
  last-fire + backfilling on boot, which **reverses** the proposal's explicit
  "restart-catch-up = skip" decision. That is a separate, larger change
  (`add-automation-durable-catchup`, not filed here). This fix keeps skip semantics
  and only stops the wrong immediate firing.
- Rejecting long crons at parse time (would kill legitimate monthly/quarterly/yearly).
- Any editor UX hint about skip semantics for long-horizon crons (candidate
  follow-up under `automation-content-view`).

## Capabilities

### Modified Capabilities

- `automation-trigger-registry` — the armed timer SHALL honor delays beyond the
  32-bit `setTimeout` ceiling (chunked long-timeout), firing at the intended
  occurrence rather than overflowing to an immediate firing loop. Restart-skip
  semantics are restated as unchanged.

## Impact

- `packages/automation-plugin/src/server/scheduler.ts` — the default `setTimer`
  becomes chunk-safe (or delegates to a small `setLongTimer` helper).
- `packages/automation-plugin/src/server/schedule-trigger.ts` — no contract change;
  benefits automatically. (If the fix is instead scoped here rather than the shared
  seam, `schedule()` clamps locally — see design decision in tasks.)
- `packages/automation-plugin/src/__tests__/scheduler.test.ts` (and/or
  `cron.test.ts`) — new red-first tests for the overflow boundary and late-arrival.
- No on-disk `automation.yaml` format change; no migration.

## Discipline Skills

- **`systematic-debugging`** — the fix rests on a precise runtime mechanism (the
  32-bit `setTimeout` clamp and the re-arm loop). Root-cause is established via a
  fake-timer test that reproduces the immediate-fire storm before any code change,
  so the fix is proven against evidence, not assumed.
- **`review-code`** — timer/clock code is easy to get subtly wrong (off-by-one at
  the `MAX_DELAY` boundary, drift from naive subtraction, double-fire on the final
  hop). A critical review pass before commit guards the boundary arithmetic.

`security-hardening`, `performance-optimization`, and
`observability-instrumentation` do not apply: no untrusted input, secrets, new
endpoint, or measured latency budget — this is a correctness fix on an in-memory
timer.
