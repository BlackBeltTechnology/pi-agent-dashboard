## Context

A running subagent feeds the dashboard over **two independent carriers**, both
fed by one `snapshotDetails()` object in the producer
(`@blackbelt-technology/pi-dashboard-subagents` 0.2.2, `extensions/agent.ts:993-1001`):

```
pushUpdate("running")
  → progress.schedule(details)     // subagents:* event_forward  — THROTTLED 250 ms
  → onUpdate({ content, details }) // tool_execution_update      — NOT throttled
```

`createProgressEmitter` (`agent.ts:409-458`) coalesces the `subagents:*` carrier
to `PROGRESS_THROTTLE_MS = 250` (`agent.ts:80`, ≤ 4/s/subagent, leading edge +
trailing flush, latest-wins). The `onUpdate` carrier has **no throttle anywhere
on its path**:

| Hop | Throttle? | Evidence |
|---|---|---|
| Producer `pushUpdate` | none — once per subagent session event | `agent.ts:1126-1191` (the only call site; no heartbeat) |
| pi core `onUpdate` → `tool_execution_update` | none — 1:1 re-emit | `dist/core/agent-session.js:509-517`; nothing throttles between `execute(..., onUpdate, ...)` (`tool-definition-wrapper.js:11`) and the emit |
| Bridge forward | none — catch-all enriched loop | `bridge.ts:1481` in `enrichedEventTypes`, sent at `bridge.ts:1902-1903` |
| Server broadcast | none (collapse is retention-only) | parent change `collapse-superseded-tool-execution-updates`, F4 |

So this carrier's rate is the subagent's **raw session-event rate** — streaming
`message_update` deltas included — against a payload carrying the cumulative
timeline. That is the wire cost this change targets.

### What each carrier is actually FOR (load-bearing; the first two drafts got this wrong)

The client hydrates `state.subagents` from **both** carriers —
`tool_execution_update` via the "durable live hydration" block
(`event-reducer.ts:1871-1933`, self-selecting on `toolName === "Agent"` +
`details.agentId`) and `subagent_*` frames via `readSubagentDetails`. They are
NOT interchangeable, and the difference decides what this change can degrade:

| | `subagents:*` (ephemeral) | `tool_execution_update` (durable) |
|---|---|---|
| Rate | 250 ms producer throttle (4 Hz) | unthrottled (raw event rate) |
| Bridge not ready | **buffered** by `SubagentFrameBuffer`, flushed on re-register | **dropped outright** (`bridge.ts:1515` `if (!sessionReady) return;`) |
| Mid-run resync | served from the retained snapshot (`bridge.ts:977-994`) | not resyncable |
| WS back-pressure | dropped (`browser-gateway.ts:126-131`) | dropped — the same generic path |
| Stored + replayed on reload | no | **yes** — this is what "durable" means |
| Carries a TERMINAL frame | yes (`progress.flush()` at `agent.ts:1218/1231/1247` then `emitSubagentCompleted`/`Failed`) | **no** — `pushUpdate` only ever emits `"running"` |

Three corrections follow, each of which killed a claim in an earlier draft:

1. **Whenever anything renders live at all, the ephemeral carrier is what paces
   it, at 4 Hz.** No throttle on the durable carrier can lower that. (During a
   bridge-not-ready window neither carrier renders: the ephemeral one is
   buffered, the durable one dropped — cadence is zero on both until
   re-register, and this change does not affect that.) A happy-path DOM-cadence
   assertion therefore proves nothing — it passes at any window value.
2. **The durable carrier's user-visible job is REPLAY**, not liveness: it is what
   a mid-run page reload folds. Throttling it costs at most one window of
   staleness there. That, plus the message row's `result`/`toolDetails` refresh
   rate, is the entire UX surface of this change.
3. **This carrier never carries a terminal frame.** The terminal snapshot leaves
   via `progress.flush()` on the ephemeral carrier and via `tool_execution_end`'s
   `result.details` (backfilled by `event-reducer.ts:2016-2070`). So the hazard is
   NOT "a dropped terminal tick" — it is a stale coalesced tick arriving AFTER
   `tool_execution_end` and unconditionally overwriting the message row's
   `result`/`toolDetails` (`event-reducer.ts:1890-1893`), visibly re-opening a
   finished tool row. (The subagent map itself is already guarded against
   regression, `event-reducer.ts:1917`.)

### What must not break

- The parent change's F4 e2e (`tests/e2e/subagent-detail-dialog.spec.ts:90-135`):
  it polls up to 30 s for ≥ 2 `tool_execution_update` frames and counts **every**
  such frame, not subagent-only.
- The **FULL-snapshot, latest-supersedes invariant** (`subagent-frame-buffer.ts`).
  Coalescing is safe only because of it; delta encoding is out.

## Goals / Non-Goals

**Goals:**

- Bound the Agent-tick rate on `tool_execution_update` to a fixed per-run
  cadence, measured on the wire.
- Never deliver a tick after that run's `tool_execution_end`.
- Keep mid-run replay staleness ≤ one window.
- Correct against every producer version in the wild, with no producer release.

**Non-Goals:**

- Changing the producer package. Its 250 ms emitter on the ephemeral carrier
  stays as-is — and this design depends on that carrier remaining unthrottled at
  4 Hz for live cadence.
- Throttling `tool_execution_update` for NON-subagent tools.
- Any delta/incremental encoding, tick-payload wire-key addition, or version
  negotiation. (The D6 counter transport IS in scope and does add a field — the
  exclusion is about the tick payload's shape, not about telemetry.)
- Payload size — that is `reduce-subagent-details-payload`; see D5.
- Creating ticks. A quiet subagent stalls exactly as it does today (D4a).
- Client-driven backpressure (watch/unwatch) — the designed escalation, not v1.

## Decisions

### D1 — Measure first, per carrier AND per `toolName`

Baseline on the docker harness, recording frames/s and bytes/s on
`tool_execution_update` **broken down by `toolName`** (Agent ticks vs. every
other tool — F4's matcher counts both, and an aggregate rate cannot tell them
apart) and on the `subagents:*` carrier. If the measured Agent-tick rate is
already ≤ the chosen cadence, the change is unnecessary and stops here.

**Fixture work is part of this step.** The existing `[[faux:subagent-sustained]]`
runs ~6 s and is ~50 % sleeping (`qa/fixtures/faux-scenarios.ts:916-926`) — it
under-runs the spec's ≥ 10 s scenario and under-represents the streaming burst
that motivates the change, so the "already ≤ 2 Hz, stop" kill switch would fire
spuriously on it. Two fixtures: a ≥ 10 s sustained variant, and a
streaming-heavy variant with minimal idle.

Not an open question: a NESTED subagent's own tool events do NOT reach this
bridge. The inner session is an in-memory `AgentSession` (`agent.ts:1091`) whose
events reach only the producer's own subscriber (`agent.ts:1126-1191`); the
bridge observes parent-session events only.

*Alternative rejected:* throttle first, measure after. The parent collapse change
already had a size intuition invert under measurement.

### D2 — Throttle at the BRIDGE, not the producer

The bridge is our code in this repo (`packages/extension/`), sees every frame,
and sits downstream of every producer version that exists — no producer release,
capability flag, minimum-version note, or multi-party compatibility matrix.

Placement: the enriched-event handler in `bridge.ts`. Nine
`mapEventToProtocol` + `send` sites exist (`bridge.ts:692, 1146, 1655, 1689,
1718, 1839, 1902, 1957, 2524`), but only `1902-1903` carries
`tool_execution_update`, and `tool_execution_end` for the same run passes
through that same site later in the same handler (after image inlining). So
both the throttle and the flush-before-terminal hook one place, and their
ordering is local rather than cross-module.

**Scope predicate** — `toolName === "Agent"` **and** `partialResult.details.agentId`
present (the same self-selecting pair the client's hydration block uses). State
is keyed per-`toolCallId`. Every other tool's update stream forwards untouched.

*Alternatives considered:*

- **Producer-side throttle on `onUpdate`** — the right fix at the source and a
  small change there, but a separate package with its own release cycle, and
  every installed producer keeps firing unthrottled. Strictly slower ship for a
  strictly smaller population. Worth proposing upstream as a follow-up.
- **Server-side coalescing** — the bytes have already crossed the bridge→server
  WebSocket, the segment the proposal targets; it would also put per-agent timer
  state on the hottest ingest path.
- **Client-driven backpressure** — strictly more capable and the designed
  escalation, but it needs a new protocol message, per-viewer state, and a
  fan-out policy for multiple browsers on one session. A fixed cadence is
  falsifiable, testable, and rollback-able with one flag.

### D3 — Trailing-edge coalescing, latest-wins, nothing after terminal

Semantics mirror `createProgressEmitter` (a proven shape in this pipeline):
leading edge fires immediately; within the window only the LATEST frame is
retained (safe: full snapshot); a trailing timer emits it at window end.

**Terminal ordering.** On `tool_execution_end` for a `toolCallId`, the pending
frame is DISCARDED, not flushed, and the key (frame + timer) deleted. Discard,
not flush, because this carrier never carries terminal state (Context §3): the
pending frame is a strictly stale intermediate snapshot, `tool_execution_end`
carries the authoritative `result.details`, and flushing it first would only
race the very overwrite the discard prevents. The guarantee is the NEGATIVE: no
tick the throttle is HOLDING reaches the client after that run's end event.

That scoping is deliberate. Suppressing a tick the producer emits *after* its
own terminal event would need an unbounded tombstone set of ended
`toolCallId`s; such a tick is an upstream contract violation, and the spec is
worded to the mechanism rather than to an unimplementable absolute. The key map
is nonetheless bounded independently of the terminal hook — an idle TTL sweeps
keys whose end event never arrived (e.g. an end dropped at the not-ready gate,
`bridge.ts:1517`), so a long session cannot accumulate one dead entry per run.
**TTL = 60 s of no tick for that `toolCallId`** — two orders of magnitude above
the 500 ms window, so it can never sweep a live run, and short enough that a
session running back-to-back subagents for hours holds a handful of keys.

**Lifecycle disposal is NEW wiring, not a reused pattern.**
`SubagentFrameBuffer.reset()` fires at exactly two points — session change
(`bridge.ts:2743`) and session shutdown (`bridge.ts:2826`) — and deliberately
NOT on connection loss (retention across a drop is its purpose). The throttle
needs its own table:

| Event | Behaviour |
|---|---|
| `tool_execution_end` for the key | discard pending, clear timer, delete key |
| session change / shutdown | clear every timer, drop every pending frame |
| newer bridge instance takes over | no eager clear is possible — an old instance learns lazily. Safety rests on the FIRE-TIME check below |
| timer fires | re-check `isActive()` **and** `sessionReady` **and** that the frame's `sessionId` still matches, and send over the LIVE connection, never a captured reference. If any check fails: drop, and increment `tickDroppedNotReady` |

Dropping at fire time is acceptable precisely because this carrier is not the
recovery path: the ephemeral carrier's retained snapshot is (`bridge.ts:977-994`),
and the terminal state arrives independently via `tool_execution_end`. Without
the counter, though, that drop is invisible — hence D6.

The information lost is intermediate `content[0].text` activity strings and
intermediate `entries` states, both superseded by construction and both already
discarded by the ephemeral carrier's 250 ms throttle.

### D4 — The cadence number: 500 ms (2 Hz)

The live floor is held by the untouched ephemeral carrier, so the window is
chosen against the two things this carrier actually owns — replay staleness and
the message-row refresh rate — with the spec floor as a backstop:

| Candidate | Verdict |
|---|---|
| 250 ms (4 Hz) | parity with the ephemeral carrier; smallest change, smallest win |
| **500 ms (2 Hz)** | **chosen** — ≤ 500 ms replay staleness; 4× the 0.5 Hz spec floor on its own carrier; ~10× fewer frames on a streaming run; keeps F4's ≥ 2-frame bar met by Agent ticks alone on F4's OWN ~6 s sleep-heavy fixture (~6–12 frames, not the ~20 a 10 s fixture would give) rather than relying on other tools' frames |
| 1000 ms (1 Hz) | only 2× the floor; on F4's ~6 s fixture the margin drops to ~3–6 frames |
| 2000 ms (0.5 Hz) | **equals** the floor — zero jitter headroom, and F4's second half (`storeTrim.collapsedUpdates` strictly increasing) gets thin on a short fixture |

Config lives in the existing shared config
(`packages/shared/src/config.ts`, `loadConfig()` — the same object the bridge
already reads for `piPort`, `bridge.ts:724`): `subagentTickThrottleMs`.
**Rollout default `0` (off); end-state default `500`** — two distinct values,
not one (an earlier draft conflated them and scheduled the e2e before the flag
was on).

**That config is file-based and read once per bridge init** (`~/.pi/dashboard/`
config JSON), with no env-var override for arbitrary keys. So "the e2e sets it
explicitly" is real work, not a flag flip: **the harness writes the dashboard
config file into the container before the pi session starts** (decided; no new
env key is added for this — the config surface stays single-sourced). Rollback
is the same shape: write `0`, then `npm run reload`.

D1's measurement, not this table, decides whether 500 is retained; if measured
replay staleness or F4 margin disappoints, the value moves down, never up.

### D4a — The floor is conditioned on producer activity

`pushUpdate` has one call site and there is no heartbeat, so a subagent quiet for
> 2 s produces ZERO ticks on either carrier and the timeline stalls — today,
before any throttle. The invariant this design can satisfy is:

> the throttle delays a tick by at most `windowMs` and never drops a tick with no
> successor; it does not and cannot create ticks.

The spec states the floor conditionally on the producer's measured rate for that
reason. A test that samples a sleep-heavy fixture and demands N advances is
measuring the fixture, not the throttle.

### D5 — Sequencing against `reduce-subagent-details-payload`

- **Land this change FIRST.** It is a pure rate limiter with a one-flag
  rollback and no store, replay, or recovery semantics in its blast radius; the
  sibling changes what is recoverable after a crash and makes the resync pull
  path load-bearing. (The sibling's migration plan orders only its own internal
  steps and makes no claim about this change.)
- If the sibling lands first, intermediate ticks already carry no `entries`, so
  the remaining win here is frame count + WS framing overhead, not payload
  bytes — restate the benefit in frames/s and re-baseline D1 post-strip.
- **The throttle must not touch the sibling's pull path.** Resync replies travel
  as synthetic `subagents:started` frames through `sendEventForward`, which the
  D2 predicate (a pi-core `tool_execution_update`) structurally cannot match.
  Structural non-interaction — but it is exactly the coupling that would silently
  defeat the sibling's cadence loop, so it gets an explicit test.

### D6 — Observability and how each claim is actually asserted

Counters: `tickForwarded`, `tickCoalesced`, `tickDiscardedAtTerminal`,
`tickDroppedNotReady`. The last two exist because they are the design's only
information-loss modes and are otherwise invisible.
`SubagentFrameBuffer.stats` is today only `console.log`ged at re-register
(`bridge.ts:2046-2050`) — there is **no existing transport for bridge counters to
`/api/health`**. Building that bridge→server counter transport is **in scope for
this change** (decided): without it the throttle's only two information-loss
modes are unobservable in production, and every counter assertion would be stuck
at L1.

| Level | Assertion | Why it is not vacuous |
|---|---|---|
| L1 vitest | window / latest-wins / discard-at-terminal / fire-time gating on the throttle unit | direct; anti-vacuity: removing the terminal discard fails the ordering test |
| L1 vitest | a `Bash` update stream passes through unthrottled | counts calls, not DOM |
| L3 e2e | Agent-tick frames on `/ws`, **filtered by `toolName === "Agent"`**, over a ≥ 10 s streaming-heavy fixture: ≥ 5 in the window (spec floor) and a mean rate ≈ 2 Hz measured over the whole window, not per 1 s bucket (leading+trailing edges of adjacent windows can legitimately put 3 frames in one bucket) | F4's matcher counts ALL `tool_execution_update`; an unfiltered count can be carried by other tools |
| L3 e2e | no Agent tick for a `toolCallId` arrives after its `tool_execution_end` | the observable hazard (message row re-opening), directly |
| L3 e2e | consecutive STORED Agent ticks are ≤ one window apart (server-side, via the session's stored events) | asserts replay staleness where it lives; a reloaded DOM is refreshed by the ephemeral carrier + resync within ms, so a DOM sample would measure catch-up, not staleness |

A DOM-level cadence assertion is explicitly NOT used: the ephemeral carrier holds
the rendered rate at 4 Hz regardless of this throttle, so such a test would pass
at any window value. (And `body.innerText()` sampling is separately known
vacuous — F4's own comment records that the elapsed-time counter and sidebar
token counters advance with zero ticks on the wire,
`subagent-detail-dialog.spec.ts:95-100`.)

## Risks / Trade-offs

- **A test that proves nothing** (DOM rate held by the other carrier; innerText
  sampling; unfiltered frame counts; per-bucket rate assertions) → D6's table,
  each row scoped to what it can falsify.
- **A stale tick lands after `tool_execution_end`**, re-opening a finished tool
  row → D3 discard-at-terminal, pinned over every terminal path (`completed`,
  `failed`, `aborted`, early error) with an anti-vacuity check.
- **A pending frame is silently dropped at fire time** (not ready / superseded
  instance) → deliberate, recovery is the ephemeral carrier's resync plus the
  terminal event; made visible by `tickDroppedNotReady`.
- **The predicate over-matches** and throttles a streaming non-subagent tool →
  allowlist predicate + counter tripwire + pass-through test.
- **The ephemeral carrier becomes load-bearing for live cadence.** It already is
  in practice, but this design now DEPENDS on it. If the producer's 250 ms
  emitter is ever removed or slowed, the live cadence degrades to this window
  with no test catching the coupling → state it in the spec (per-carrier
  falsifiability) and re-check on any producer bump.
- **Mid-run replay is up to one window stale** → the accepted, measured trade;
  500 ms is imperceptible against a 250 ms live carrier.
- **The win is small once the sibling lands** → D5; measure post-strip, restate
  in frames/s, kill the change if the number does not justify it.

## Migration Plan

1. Add the two fixtures (≥ 10 s sustained; streaming-heavy) and the harness
   config-injection path the e2e needs (write the dashboard config file into the
   container before the pi session starts).
2. Measure (D1): per-carrier, per-`toolName` frames/s and bytes/s. Stop if the
   Agent-tick rate is already ≤ 2 Hz.
3. Land the throttle (D2/D3/D4) with `subagentTickThrottleMs` defaulting to `0`,
   plus its vitest suite, in one commit.
4. Land the counters + `/api/health` transport (D6), then the e2e assertions —
   each setting `subagentTickThrottleMs` explicitly rather than relying on the
   rollout default.
5. Flip the shipped default to `500`, re-measure, record before/after.

Rollback: set `subagentTickThrottleMs = 0` in the dashboard config and
`npm run reload` — every frame then forwards immediately, behaviour
byte-identical to today. It is a config write + reload, not a runtime toggle.
No producer, protocol, store, or client rollback exists to do.

## Open Questions

- Fixed window or **adaptive** (widen as the timeline grows)? Fixed is specified
  here; D1's bytes/s curve decides whether adaptivity earns its state.
- Is one window (500 ms) of mid-run replay staleness acceptable to a human
  watching a refresh, or does the reload need to trigger a resync instead?
  (Manual judgment; deferred to post-merge verification.)
- Does the qa/ shell layer carry any of this, or is vitest + Playwright the right
  split? Nothing here is obviously per-OS.
