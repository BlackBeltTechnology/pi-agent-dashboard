# D1 Measurement — reduce-bridge-tick-bandwidth

Date: 2026-08-17 · Harness: `docker/test-up.sh`, port `18170` (from
`.pi-test-harness.json#dashboardPort`) · Image built from this worktree's
committed source.

Instrumented two independent observation points, so neither can be blamed on the
other:

- **Bridge-side** — `agents[].tickForwarded/tickCoalesced/tickDiscardedAtTerminal/
  tickDroppedNotReady` on `/api/health` (the D6 transport, per-session).
- **Browser-side** — `tool_execution_update` frames on `/ws`, filtered by
  `toolName === "Agent"` (`collectAgentTicks`), with per-frame receive time and
  payload bytes.

## Result — the gate in task 2.2 FIRES

| run | `subagentTickThrottleMs` | fixture | window | bridge `tickForwarded` | browser Agent frames | Agent frames/s | Agent bytes/s |
|---|---|---|---|---|---|---|---|
| OFF-streaming | 0 | `subagent-streaming` | 25.4 s | 9 | 9 | **0.35** | ~348 |
| OFF-sustained-long | 0 | `subagent-sustained-long` | 25.1 s | 9 | 9 | **0.36** | ~345 |
| ON-streaming | 500 | `subagent-streaming` | 25.1 s | 1 (coalesced 7, discarded 1) | 1 | 0.04 | ~39 |

**Measured Agent-tick rate with the throttle OFF is ~0.36 frames/s — two orders
of magnitude below the 2 Hz kill-switch threshold.** Task 2.2's instruction on
this outcome is explicit: STOP, and correct the proposal's benefit framing
instead of building the throttle.

## Why the rate is so low — the carrier is BURSTY, not sustained

Inter-arrival gaps between consecutive Agent ticks, throttle OFF (ms):

```
streaming        : [0, 0, 0, 0, 1, 2, 4, 257]
sustained-long   : [0, 0, 0, 0, 1, 5, 5, 244]
offsets from t0  : [0, 1, 1, 1, 240, 240, 240, 242, 243]
```

Every tick of the run lands within ~250 ms of the subagent starting, and then
the carrier goes silent for the rest of the run. It is not a stream at the
subagent's raw session-event rate; it is a **single start-of-run burst of ~9
frames**, worth ~350 B/s averaged.

This falsifies the proposal's and `design.md`'s Context premise:

> So this carrier's rate is the subagent's **raw session-event rate** — streaming
> `message_update` deltas included — against a payload carrying the cumulative
> timeline. That is the wire cost this change targets.

The wire cost being targeted is ~350 B/s and ~0.36 frames/s per running
subagent. There is no bandwidth problem here to reduce.

## Three consequences, each design-level

### 1. The throttle is NET-HARMFUL at this frame shape

Because the whole burst falls inside ONE 500 ms window, `9 forwarded` becomes
`1 forwarded + 7 coalesced + 1 discarded-at-terminal`. D3's discard argument —

> the pending frame is a strictly stale intermediate snapshot […] flushing it
> first would only race the very overwrite the discard prevents

— assumes a LATER leading edge exists to carry the newest state. When the burst
IS the entire run, the discarded frame is the run's most complete durable
snapshot and nothing on this carrier replaces it.

### 2. It breaks the parent change's F4, measured

`subagent-detail-dialog.spec.ts` → "the live subagent timeline keeps advancing
while collapse is active" (>= 2 `tool_execution_update` frames in 30 s):

- `subagentTickThrottleMs = 0` → **passes** (13.9 s)
- `subagentTickThrottleMs = 500` → **fails**

D4 chose 500 ms specifically to keep that bar met by Agent ticks alone
("~6–12 frames"). Against measured reality the run yields **1**.

### 3. The >= 10 s sustained fixture the test plan requires is not constructible

`subagent-sustained-long` (task 1.1) drives an inner `[[faux:
subagent-slow-inner-long]]` of four 3 s sleeps, yet the parent round-trip
completes in **2.0 s** and produces the same 9-frame / 243 ms burst as the
existing `subagent-sustained`. The inner sentinel does not extend the subagent's
life in this harness, so the producer never emits over a >= 10 s window.

F1, P1, P3 and P4 all specify a >= 10 s continuous-producer window. That window
does not exist, which makes those rows unrunnable as written — an unmet "New
infra needed" precondition in `test-plan.md`, not an implementation slip.

## What was built anyway (left in the worktree, unreverted)

The throttle unit, its config, the D6 counters, their transport, and the L1/L3
suites are all implemented and committed. The L1 suite is green (21 + 5 tests).
X7/X8 (counter transport + predicate tripwire) are green against the harness —
they are what produced the bridge-side numbers above. Nothing here is wasted if
the change is re-scoped; the parts that fail are exactly the ones whose premise
the measurement removed.

Note also that the D6 transport was cheaper than `design.md` assumed: it claimed
"there is **no existing transport for bridge counters to `/api/health`**", but
the heartbeat's `processMetrics` is exactly that transport
(`droppedBufferedFrames` already rides it), so the counters were folded in
rather than built new.
