# Test Plan — add-watchdog-force-close-diagnostic

Stage: proposal   Generated: 2026-09-14

Gate resolved: the "far above threshold" slot was unfillable as an adjective. Rather than pick a ratio, the change measures check-tick drift directly, which turns the classification into a measurement. No open clarifications.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Watchdog force-close is attributable | state-transition | L1 | automated | `ConnectionManager` with `watchdogTimeout` 60 000 and an `onWatchdogFire` callback; one message received at t=20s | watchdog tick at t=90s sees 70s of silence | `onWatchdogFire` called exactly once with `silentForMs >= 60_000` |
| E2 | Watchdog force-close is attributable | BVA (just below boundary) | L1 | automated | same manager; messages arriving every 20s for 100s | every watchdog tick sees `< 60_000` silence | `onWatchdogFire` never called; `isConnected` stays true; exactly 1 socket created |
| E3 | Watchdog force-close is attributable | state-transition (illegal read after teardown) | L1 | automated | manager whose socket is OPEN (`readyState` 1) | watchdog fires at t=60s | reported `readyState === 1` while the underlying socket ends at `3` — proves capture precedes teardown |
| E4 | Watchdog force-close is attributable | decision-table (reporter absent) | L1 | automated | manager constructed with **no** `onWatchdogFire` | watchdog fires at t=60s | force-close + reconnect occur exactly as before the change; no throw |
| E5 | A silent peer is distinguished from a blocked loop | equivalence partition (healthy loop) | L1 | automated | manager with timers firing on schedule | watchdog fires after 60s of peer silence | `maxTickDriftMs < 1_000` — silence attributed to the peer |
| E6 | A blocked loop is attributed to this process | equivalence partition (starved loop) | L1 | automated | manager; wall clock advanced 90s **without** timers firing, then one tick | that delayed tick fires | `maxTickDriftMs >= 85_000` — silence attributed to local starvation |

### Frontend-quirk (event-loop ordering)

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Observed silence is confirmed after the poll phase | state-transition (illegal edge: close on a live peer) | L1 (real timers, out-of-process peer) | automated | peer in its OWN process sending every 100 ms; `watchdogTimeout` 1 000 ms, check interval 200 ms | 1 500 ms sync block INSIDE the `onMessage` handler | 0 force-closes; peer accepts exactly 1 connection; `received > 3` |
| F2 | Observed silence is confirmed after the poll phase | state-transition (legal edge preserved) | L1 | automated | peer that has genuinely stopped | silence passes threshold, deferred re-check runs | force-close + reconnect still occur (covered by E1/E4 after the deferral) |

> F1 is deliberately NOT a fake-timer test. The defect is an event-loop **ordering** property: under `vi.advanceTimersByTime` there are no real socket reads for the watchdog to beat, so a fake-timer version passes against the broken code. The peer must also be out-of-process — an in-process peer is frozen by the same block, which makes the silence genuine and silently inverts the result.

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Watchdog force-close is attributable | fault-injection (reporter throws) | L1 | automated | `onWatchdogFire` throws `Error` | watchdog fires at t=60s | `isConnected === false`; after the 1s backoff a second socket exists — the throw neither blocks teardown nor the reconnect |
| X2 | The force-close diagnostic is durable | fault-injection (no sink yet) | L1 | automated | `transportDiagnostics` with no attached sink (pre-registration) | `record({event:"watchdog_force_close"})` then `attach(sink)` with a resolvable sessionId | the buffered diagnostic is flushed on attach, carrying `event: "watchdog_force_close"` |

### Frontend-quirk

_None. This change produces no rendered-UI surface; the diagnostic's only consumer is `server.log`._

### Performance

_None. The added work is one subtraction and one comparison per 15 s tick, plus one string format per force-close. No workload, metric or threshold in the spec to test against — asserting one would be inventing a requirement._

---

## Coverage summary

- Requirements covered: 4/4 (`Watchdog force-close is attributable`, `Observed silence is confirmed after the poll phase`, `Every live connection reports its force-closes`, `The force-close diagnostic is durable`)
- Scenarios by class: edge 6 · perf 0 · frontend 2 · error 2
- Scenarios by level: L1 10 · L2 0 · L3 0
- Disposition: automated 10 · manual-only 0

## Known coverage gap (recorded, not folded)

`Every live connection reports its force-closes` (the `/dashboard-connect` move target) has **no automated row**. The second `ConnectionManager` is constructed inside a closure passed to the move coordinator (`bridge.ts`), reachable only by driving a full `/dashboard-connect` against a second live dashboard — an L2/L3 fixture disproportionate to a one-line wiring guarantee. The requirement is carried by the shared `formatWatchdogFire` helper and by review, not by a test. Recorded here so the gap is deliberate and visible rather than silently uncovered.
