## Context

`reduce-subagent-details-payload` (archived 2026-08-15) moved the running
subagent timeline from push to pull: the bridge strips `details.entries` from
every non-terminal frame on both carriers, keeps the FAT frame in
`SubagentFrameBuffer`, and serves it back on a `subagent_resync_request` as a
synthetic `subagents:started` `event_forward`. A mounted inspector re-fires that
request on a cadence (D4 v1, `useSubagentResyncCadence.ts`, `CADENCE_BASE_MS =
2000`, backoff to 30 s).

Four of its manifest scenarios shipped unverified (F1, P4, P5, X1 — see
`proposal.md`). All four have the SAME root blocker: **the harness has no
subagent that stays alive long enough to be watched.**

### Why the harness has no watchable subagent

Already root-caused, in the harness fixtures themselves
(`qa/fixtures/faux-agent-ticks.ext.ts`):

> A nested faux subagent cannot sustain a ≥ 10 s tick stream in the harness —
> its inner `createAgentSession` resolves a DIFFERENT faux core with an empty
> response queue, so a faux subagent dies after ~2 no-op turns.
> (`reduce-bridge-tick-bandwidth`, measurement.md — "what still blocks the L3
> rows", item 2; cited as "Bug 2" in that change's tasks/test-plan)

The scripted `sleep`s in `subagent-slow-inner` never execute because the inner
session dies before reaching them. The predecessor change already removed the
`subagent-*-long` fixtures for this reason and routed around it with a
**synthetic `Agent`-tick producer** (staged under `PI_SYNTH_AGENT_TICKS=1`,
first-registration-wins over the real subagents `Agent` tool).

So the proposal's "fix or route around" question is already answered: **route
around, on the existing synthetic substrate.** This change extends that
substrate from a tick emitter into a full pull-path substrate.

### What the synthetic producer does NOT yet drive

| Path | Today | Needed |
|---|---|---|
| `tool_execution_update` with `toolName: "Agent"` + `details.agentId` | ✅ emitted at a scripted cadence | — |
| `details.entries` | ❌ always `[]` | must GROW 5 → 30 (F1) |
| `subagents:created/started/completed` bus frames | ❌ never emitted | required — the strip, the buffer, and the RESYNC SOURCE all live on that channel (`subagent-frame-buffer.ts` `SUBAGENT_CHANNELS`) |

Without the bus frames there is no fat snapshot retained, so
`subagent_resync_request` is answered with a no-op and the pull path is not
exercised at all. This is the single load-bearing gap.

The bus is shared and `registerEventBusForwarding` subscribes with `on()`, which
"observes every emitter" (`flow-event-wiring.ts`) — so frames emitted by a
fixture extension traverse the exact production strip → buffer → resync path,
with no bridge change.

### Instrumentation inventory — what is and is NOT readable from an E2E spec

| Signal | Where | E2E-readable? |
|---|---|---|
| Per-frame wire bytes off the browser `/ws` socket | `collectAgentTicks` (`tests/e2e/helpers/index.ts`) | ✅ `tool_execution_update` only today |
| **Resync-reply discriminator** `__resyncRequestId` | `subagent-forward-sites.ts:67`; routed requester-scoped by `server/src/pairing/subagent-resync-routing.ts` | ✅ **on the wire** — the ONLY way to tell a reply from a pushed `subagent_started` |
| Inspector-open share | `__piSubagentInspectorTelemetry()` | ✅ page-global aggregate; `resetInspectorTelemetry` is NOT exposed on `globalThis` |
| `SubagentFrameStats.resyncRequests / resyncServed / resyncCadence` | `subagent-frame-buffer.ts` | ❌ **bridge-process-internal.** The heartbeat carries `subagentTickThrottle.stats` only; `/api/health` carries server-side `storeTrim`. No spec can read these, and exposing them would be production code this change is not allowed to write. |
| Strip rollback switch | `PI_DASHBOARD_SUBAGENT_STRIP=0` (`subagent-frame-strip.ts`), read PER CALL | ⚠️ but it is a CONTAINER env var, fixed for the life of the harness → one harness start per arm |
| Outgoing `subagent_resync_request` frames, incl. their `reason` (`"open"` \| `"cadence"`) | browser `/ws`, observable via Playwright `ws.on("framesent")` | ✅ the only way to tell WHICH trigger produced a reply |
| Mid-run process kill | `force_kill` browser-socket message | ⚠️ closes the bridge WS BEFORE the signal (`session-action-handler.ts`) |

Three facts below are load-bearing and were verified in source, not assumed:

- **Terminal frames are never stripped** (`subagent-frame-strip.ts` terminal
  guard; `tool_execution_end` stays fat) and the reducer applies their `entries`
  (`event-reducer.ts` `subagent_completed` / `tool_execution_end` backfill). A
  terminal frame therefore converges a rendered count all by itself.
- **The open-time resync DOES fire in F1, and there are THREE request sites, not
  one.** `requestResyncIfStale` requires `emptyTimeline` — and under the strip
  the client timeline IS empty at mount (thin pushes omit `entries`; the
  reducer's D3 guard never overwrites with an empty array). So expand/popout
  (`AgentToolRenderer.tsx:264-268`) fires it, and `App.tsx:1030-1050` fires one
  more on session subscribe for every running empty-timeline subagent. A design
  that assumes "the cadence is the only pull trigger" is wrong: the
  producer-side entry count (5) is NOT the rendered count (0).
- **Resync replies are PERSISTED, fat.** Every `event_forward` is stored
  (`event-wiring.ts` → `insertEvent`), and the reply is never stripped. So a
  single resync during a run puts a full timeline in the durable store — which
  is precisely what X1 must NOT have (V4).
- **The bus carrier is coalesced to 250 ms by the real producer**
  (`bridge.ts:384-387`); only `tool_execution_update` is throttled at the
  bridge. A fixture emitting bus frames per 50 ms tick is a ~5× inflated push
  stream that exists nowhere in production.

## Goals / Non-Goals

**Goals:**

- A harness substrate on which a subagent timeline demonstrably GROWS while an
  inspector watches it, with the push frames provably thin and the pull replies
  provably fat and identifiable.
- F1 asserted on RENDERED entry count, with no close/reopen, and with the
  delivering carrier positively identified — not inferred.
- X1 asserted on a real mid-run process kill followed by a real replay.
- P4 measured as a like-for-like byte comparison over BOTH carriers at ONE
  observation point, with its fixture-cadence dependence made explicit.
- P5 recorded with its watch pattern stated, so the number cannot be read as
  more than it is.
- All numbers land in this change's own `heap-evidence.md`, cross-referencing
  the parent's archived evidence.

**Non-Goals:**

- Any production behaviour change — including any new counter, config knob, or
  test hook in `packages/`. Everything this change adds lives in
  `qa/fixtures/`, `tests/e2e/`, `docker/`, and the evidence file. **Any
  assertion that requires a production surface to exist is out of scope by
  construction and must be redesigned, not enabled.**
- Making a nested faux subagent scriptable. Abandoned upstream; out of scope.
- Field-representative measurement. A scripted harness cannot produce one (V6).
- Re-verifying anything the parent already gated (P1 growth bound, terminal
  fidelity, collapse).

## Decisions

### V1 — Extend the synthetic producer into a full pull-path substrate

`faux-agent-ticks.ext.ts` gains, **entirely behind new prompt sentinels** — the
bus emission AND the entry growth are both sentinel-gated, so every existing
throttle row on the shared `PI_SYNTH_AGENT_TICKS=1` arm is byte-identical:

- `[[entries:<start>..<end>]]` — the timeline grows from `<start>` to `<end>`
  across the tick plan; each frame carries a FULL snapshot of the current
  timeline (latest-supersedes, per the pipeline invariant — never a delta).
  Entry payloads are fixed-size and small, so the whole serialized snapshot
  stays far below the store's ~256 KiB `maxEventDataSize` budget (see V3).
- `[[bus:<intervalMs>]]` — emit `subagents:created` once, `subagents:started`
  **coalesced at `<intervalMs>`, DEFAULT 250 ms to match the real producer**
  (`bridge.ts:384-387`), and `subagents:completed` at the end, via
  `pi.events.emit`. The bus cadence is deliberately DECOUPLED from the tick
  interval: coupling them would fabricate a 5× inflated push arm in P4.

**Frame-shape contract (load-bearing, must be asserted at L1):**

- The bus frame's TOP-LEVEL `data.id` MUST equal `details.agentId`.
  `SubagentFrameBuffer.agentIdOf` keys snapshots on `data.id` and `resync()`
  looks up by it; a fixture that only sets `details.agentId` makes every resync
  a silent no-op and every row below unfalsifiable-in-the-wrong-direction.
- `subagents:created` MUST carry NO entries. Its status (`"created"`) is not in
  the strip allowlist (`NON_TERMINAL_STATUSES` = `queued` | `running`), so a
  fat `created` frame would forward unstripped and break V2 guard (1).

**Run-shape contract (load-bearing for F1):** the timeline MUST plateau at the
end count and the agent MUST keep emitting RUNNING frames for at least 3 cadence
intervals (≥ ~6 s at `CADENCE_BASE_MS = 2000`) before the terminal frame. If the
count reaches 30 on the last tick and `completed` follows immediately, the DOM is
still below 30 when the non-terminal assertion window closes (the first cadence
reply is 2 s out) — F1 then fails by construction and the terminal frame
"converges" it vacuously. The fixture pins tick interval, growth span, and
plateau hold as explicit numbers, not as "across the tick plan".

*Rationale:* the bridge keys on channel name + `data.id` + status, never on
producer identity. A fixture emitting the same frames on the same bus is a
faithful substrate for every hop this change verifies, and it is fully
deterministic.

*Fidelity boundary, stated once and repeated in the fixture header:* this proves
the bridge → server → client pull path. It does NOT prove that
`@blackbelt-technology/pi-dashboard-subagents` emits this shape; that stays
covered by the existing `subagent-spawn` scenario.

*Alternatives rejected:* fixing the nested faux subagent (root-caused as
unfixable-in-harness upstream); a real model-backed subagent (non-deterministic,
needs credentials); asserting at L1 on a hand-built frame sequence (that is
`useSubagentResyncCadence.test.tsx`, which the proposal already calls
insufficient).

### V2 — Prove the PULL path is what runs, using the wire discriminator

The trap this change exists to avoid: if the pushed frames still carry
`entries`, F1 converges on PUSH traffic while looking green.

`subagent_started` arrives BOTH as a pushed per-interval frame and as a resync
reply, so **eventType cannot classify them.** The discriminator is
`__resyncRequestId`, echoed on the reply frame only. Every classification in
this change keys on it.

Guard rows, all read off the browser `/ws` socket:

1. Every observed `tool_execution_update` / `subagent_*` frame for the watched
   `agentId` **without** `__resyncRequestId`, while the agent is non-terminal,
   carries no (or empty) `entries`.
2. At least one frame **with** `__resyncRequestId` arrives during the run and
   carries a NON-empty `entries`.
3. Anti-vacuity arm: on a separate harness start with
   `PI_DASHBOARD_SUBAGENT_STRIP=0`, guard (1) INVERTS — pushed frames are fat.
   If it does not invert, the arm switch is not wired and every measurement
   below is measuring one arm twice.

No bridge counter is read anywhere. `resyncServed` / `resyncCadence` are
unreadable from a spec, and exposing them is forbidden by the Non-Goals.

### V3 — F1 asserts RENDERED entries, and identifies the delivering carrier

Mount the inspector for the running subagent BEFORE the timeline passes the
start count, hold it open for the whole run, and assert the DOM entry count
converges to the end count with no close/reopen and no reload.

**Anti-vacuity is by carrier exhaustion, not by a disable-run.** FOUR carriers
could deliver 30 entries to the DOM:

| Carrier | Ruled out how |
|---|---|
| Terminal frame (`subagents:completed` / `tool_execution_end`, never stripped, always fat) | The assertion window **closes while the agent is still non-terminal** — before any terminal frame for that `agentId` is observed on the socket. Asserted, not assumed; the V1 run-shape contract is what makes it reachable. |
| Fat push frames | V2 guard (1) |
| Open-time resync (`AgentToolRenderer` expand/popout, `App.tsx` subscribe) — **fires in F1**, because the rendered timeline IS empty at mount | Its reply carries the buffered snapshot as of BRIDGE-HANDLING time (`serveSubagentResync`), i.e. up to one bus interval + RTT after the request left the browser. The row asserts the DOM passes a count STRICTLY GREATER than the timeline could hold at that moment — requests read off `ws.on("framesent")`, with the bus interval added as slack. Growth spans seconds, so the margin is comfortable. |
| Cadence resync | What remains |

To make the cadence positive rather than residual, the row ALSO asserts:

- at least one outgoing `subagent_resync_request` with `reason: "cadence"` was
  sent while the inspector stayed mounted (never closed/reopened), and
- a reply whose `__resyncRequestId` **equals that captured cadence request's
  `requestId`** carried ≥ the converged count, and arrived before the DOM
  reached it. Token equality, not mere ordering — otherwise a reconnect-driven
  `reason: "open"` reply would satisfy the clause.

*A cadence-disable falsifiability run is explicitly NOT used:* no such knob
exists (`CADENCE_BASE_MS` is a module constant; the only "switch" is the hook's
`key` going undefined with the view unmounted), and adding one is production
code the Non-Goals forbid. Carrier exhaustion is the stronger check anyway — it
proves what DID deliver, not merely that something broke when a knob moved.

*Count choice:* the head-tail ceiling is a **BYTE** budget
(`exceedsSerializedSize(data, maxEventDataSize)`, ~256 KiB, K_HEAD=1/K_TAIL=4),
not an entry count, so "30" is safe only because V1 fixes the per-entry payload
small. This is stated because a count-based intuition here is a category error:
if the budget ever fired, the reply would render 1 + sentinel + 4 and F1 would
fail undiagnosably. 30 is chosen as comfortably observable, well inside the byte
budget. It is NOT chosen to probe the historical `> 20` generic-clobber
boundary: D5a landed (`locateSubagentTimeline` matches `subagent_*`), so that
clobber is unreachable for this carrier and the count tests no boundary at all.

### V4 — X1 kills the process, and proves absence of a terminal frame in the STORE

Drive the substrate, let the timeline accumulate, then `force_kill` the session.

**X1 MUST be an UNWATCHED run, and that is a precondition, not a detail.** A
resync reply is stored FAT (`event-wiring.ts` → `insertEvent`), so ONE resync
during the run puts a full timeline in the durable store and the replay then
shows a mid-run timeline — failing the requirement for a reason that has nothing
to do with the regression. Both open-time request sites must therefore stay
unfired: no inspector mounted, and **the session not selected in the client
during the run** (`App.tsx` fires a subscribe-resync for every running
empty-timeline subagent). Drive the prompt via the API, keep the browser off
that session, and ASSERT zero outgoing `subagent_resync_request` for that
`agentId` before the kill.

`force_kill` closes the bridge WebSocket BEFORE the signal lands, so "no
terminal frame observed on the socket" proves nothing — it cannot distinguish
"none emitted" from "emitted, not observed". The assertion is therefore made
where it is decidable:

- The run had not reached its scripted end. The tick index is read POST-KILL
  from the replay stream (stored ticks carry their `(running… i)` content), NOT
  live: observing ticks live requires subscribing to the session, and
  subscribing fires the `App.tsx` open-resync this row must avoid.
- On the post-kill **replay stream** — the stored events the server re-sends on
  subscribe — there is no `subagent_completed` / `subagent_failed` /
  `tool_execution_end` for that `agentId`, and no stored frame carrying
  `entries` for it. There is no list-events endpoint
  (`GET /api/events/:sessionId/:seq` returns ONE event by exact seq), so the
  replay socket is the observation surface, not a REST sweep.

Then assert the replayed render: scalar state present, NO mid-run timeline, and
the card neither blank nor error-rendered. Note the replay-time subscribe-resync
is a no-op only because the killed bridge holds no snapshots — pin that
explicitly rather than relying on it silently.

*Caveat pinned as-observed:* the client's stuck-card supersede-heal may finalize
or badge a killed Agent call. The exact rendered outcome is DETERMINED
EMPIRICALLY in this step and then pinned; the row's job is to stop that
behaviour from drifting silently, not to assert a preferred outcome invented in
advance. Whatever is observed is recorded in `heap-evidence.md` as the pinned
baseline.

*Fallback:* if `force_kill` turns out to flush a terminal frame into the store,
escalate to a container-level `SIGKILL` of the pi PID and record which mechanism
was used.

### V5 — P4 is one observation point, both carriers, one variable

Both halves are read off the SAME browser `/ws` socket, in bytes, over the same
workload and window, with `subagentTickThrottleMs` **identical in both arms**
(the throttle and the strip are different mechanisms; letting both move makes
the number meaningless):

| Arm | Env | Quantity (per subscriber, for the watched `agentId`) |
|---|---|---|
| pull | strip ON (default) | bytes/s of frames bearing `__resyncRequestId` |
| push | `PI_DASHBOARD_SUBAGENT_STRIP=0` | bytes/s of subagent-carrying frames across **BOTH** carriers (`subagent_*` AND `tool_execution_update`), **EXCLUDING** `__resyncRequestId` frames (the client still pulls in this arm), minus the pull arm's push-side bytes — i.e. the bytes the strip actually removes |

`PI_DASHBOARD_SUBAGENT_STRIP` is read per call, but it is a container env var
fixed for the life of the harness — so each arm is a SEPARATE harness start, not
a per-test toggle.

**Byte semantics must be defined before they are compared.** `collectAgentTicks`
today records `bytes: payload.length` for EVERY event inside a batched frame,
over-counting batches N×. The generalized helper attributes bytes per FRAME
(splitting a batch by its own serialized event sizes), and the definition is
recorded alongside the numbers.

**Pass condition:** pull bytes/s ≤ push bytes/s removed. Exceeding it triggers
the D4 v2 escalation — filed as a follow-up change — NOT a cadence tweak here.

**The verdict is conditional on the fixture's bus cadence, and the report says
so.** At V1's production-matched 250 ms the comparison is meaningful; at the
50 ms tick interval it would be rigged in the pull arm's favour by 5×. So the
deliverable is a small **sensitivity table** — the ratio at 250 ms (the headline
verdict) plus at least one faster and one slower bus interval — not a single
pass/fail number. A verdict that flips across that table is itself the finding.

Because the push quantity is a DIFFERENCE across two separate harness starts, it
carries run-to-run batching and timing noise. Each arm runs ≥ 3 times; the table
reports median and spread, and a verdict that falls inside the spread is
recorded as INCONCLUSIVE rather than a pass. **INCONCLUSIVE is a shippable
outcome** — the measurement infrastructure is this change's deliverable; it does
not escalate to D4 v2 (that needs a verdict, not an absence of one) and it does
not block.

N inspectors = N browser contexts against the same session; the reply is
requester-scoped (`subagent-resync-routing.ts`), so per-subscriber is the honest
unit. N comes from a measured harness ceiling, not an assumption.

### V6 — P5 reports a SHARE WITH ITS WATCH PATTERN, in a fresh context per arm

A scripted harness cannot produce a field-representative inspector-open share:
the share is whatever the script's watch pattern makes it. Holding an inspector
open for the whole run yields 100 % by construction — as meaningless as the
parent's 0.0 %.

Deliverable: **four readings**, each with its pattern and run length recorded:

| arm | pattern | expected ≈ |
|---|---|---|
| unwatched bound | never opened | 0 % |
| glance | open at 25 % of runtime, hold 25 % | ≈ 25 % |
| threshold | open at 25 % of runtime, hold 50 % | ≈ 50 % — sits ON the C4 boundary, so it tests the boundary rather than a random point |
| watched bound | open before the first entry, never closed | 100 % |

`__piSubagentInspectorTelemetry()` is a **page-global cumulative aggregate** and
`resetInspectorTelemetry` is not exposed on `globalThis`, so the three arms MUST
run in separate browser contexts. Sharing one context blends them into a single
meaningless share.

**C4 reporting rule:** a share above 50 % is reported as the kill-switch
condition ONLY together with its pattern. The honest conclusion available here
is "the signal is readable and behaves as expected across the watch spectrum";
the field number still comes from the production counter, and
`heap-evidence.md` says so in those words.

### V7 — Evidence lives in THIS change

`openspec/changes/verify-subagent-pull-under-load/heap-evidence.md` records the
substrate proof (V2), the F1 carrier-exhaustion verdict, the X1 pinned baseline,
the P4 sensitivity table, and the P5 curve. It cross-references
`openspec/changes/archive/2026-08-15-reduce-subagent-details-payload/heap-evidence.md`
§3/§4 by path. The archived file is NOT edited — an archived change is a record,
not a working artifact.

## Risks / Trade-offs

- **F1 converges on a carrier other than the cadence reply** (terminal frame,
  fat pushes, or open-time resync) → V3's carrier-exhaustion table, with the
  non-terminal assertion window as the load-bearing part. This is the failure
  mode both review passes flagged as fatal in the first draft.
- **A push/reply mix-up in classification** (`subagent_started` is both) →
  everything keys on `__resyncRequestId`, never on eventType.
- **An open-time reply is mistaken for a cadence reply** → outgoing requests are
  read off `framesent` and discriminated by `reason`; F1 additionally requires
  the converging count to exceed what existed at the last `open` request.
- **A stray resync fattens the X1 store and fails the row for the wrong reason**
  → X1 is an explicitly unwatched run with a zero-resync-requests assertion; the
  `App.tsx` subscribe-resync is the specific hazard.
- **An assertion needs a production surface that does not exist** (bridge resync
  counters, a cadence-disable knob) → both were removed from the design rather
  than enabled; the Non-Goals now state this as a hard rule so it cannot creep
  back during implementation.
- **P4 becomes arithmetic on fixture constants** → the bus cadence defaults to
  the production 250 ms and the verdict ships as a sensitivity table, so a
  cadence-driven flip is visible instead of hidden.
- **The strip arm switch is silently unwired**, measuring one arm twice → V2
  guard (3)'s inversion, on a separate harness start.
- **The synthetic substrate is not the real producer** → fidelity boundary
  stated in V1, in the fixture header, and in `heap-evidence.md`.
- **X1's replayed render is not what anyone predicted** (supersede-heal
  finalizes or badges the card) → V4 pins what is OBSERVED rather than asserting
  a guessed outcome; a surprise is recorded, not swallowed.
- **N browser contexts saturate the harness**, so P4 measures the harness →
  measure the ceiling first, report per-subscriber, record N with its evidence.
- **The measurement finds the cadence costs more than the push.** A legitimate
  outcome, not a failure of this change → routed to a D4 v2 follow-up.

## Migration Plan

Strictly ordered — each step is unusable before the previous one is green:

1. Substrate (V1) + its L1 frame-shape test + the guard rows (V2), including the
   strip-OFF inversion and the env passthrough.
2. F1 (V3) with the carrier-exhaustion assertions.
3. X1 (V4); determine and pin the replayed render.
4. P4 (V5) — harness ceiling, then the A/B, then the cadence sensitivity table.
5. P5 (V6) — the watch-pattern arms, one browser context each.
6. `heap-evidence.md` (V7); file the D4 v2 / C4 follow-up change if either
   trigger fired.

Rollback: everything added is test-side (one fixture, harness env passthrough,
E2E specs, one helper generalization). Reverting removes coverage and nothing
else — there is no production surface to roll back.

## Open Questions

- Does `force_kill` leave the store free of a terminal frame for the killed
  agent, or does a shutdown path flush one? Determined empirically in step 3;
  the fallback is a container-level kill.
- What N does the harness sustain for concurrent browser contexts before the
  measurement is dominated by contention?
- Should the substrate fixture also cover `subagents:failed` (a terminal-fail
  arm), or is `completed` sufficient for the four scenarios in scope?
