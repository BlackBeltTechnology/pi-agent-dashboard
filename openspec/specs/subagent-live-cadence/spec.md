# subagent-live-cadence Specification

## Purpose
TBD - created by archiving change reduce-bridge-tick-bandwidth. Update Purpose after archive.
## Requirements
### Requirement: A bandwidth reduction SHALL preserve a live-looking subagent cadence

Any reduction of `tool_execution_update` wire traffic SHALL hold the rendered
subagent timeline at or above **1 rendered update per 2 s** (0.5 Hz) **for as
long as the producer emits updates at or above that rate**.

The floor is conditional because the producer has no heartbeat: `pushUpdate` has
a single call site on the subagent's session-event subscription, so a quiet
subagent (an inner sleep, a non-streaming think) emits nothing and no throttle
can create ticks. The obligation on a reduction is therefore twofold — it SHALL
NOT delay an update by more than its declared window, and it SHALL NOT drop an
update that has no successor — where the run's terminal event counts as a
successor, since it carries the authoritative final state.

That floor is the acceptance threshold; a design may declare a higher one, never
a lower. It is stated as a number here so the requirement is falsifiable rather
than left implicit in an emitter's default. It is deliberately distinct from the
existing F4 frame-count assertion (≥ 2 frames per 10 s window), which is a
non-vacuity floor on the transport, not a UX cadence.

**Per-carrier falsifiability.** The rendered timeline is fed by TWO carriers —
`tool_execution_update` (durable: persisted and replayed) and the `subagents:*`
`event_forward` frames (ephemeral, producer-throttled to 250 ms). A reduction
applied to ONE carrier SHALL be asserted on THAT carrier's own frames, not on
the rendered DOM alone: the untouched carrier would otherwise hold the observed
cadence and the requirement would pass at any throttle value. A DOM-level
assertion is admissible only in a window where the reduced carrier is
demonstrably the only feed.

#### Scenario: Throttled ticks still advance at the floor on their own carrier

- **GIVEN** a subagent whose producer emits `tool_execution_update` ticks at a
  measured rate of at least 1 Hz for at least 10 s
- **AND** bridge tick throttling active
- **WHEN** the `tool_execution_update` frames received by the browser whose
  `toolName` is `Agent` are counted over that window
- **THEN** at least **5** SHALL arrive (≥ 1 per 2 s)
- **AND** at least 2 SHALL arrive, so the existing F4 scenario remains
  non-vacuous and is not carried by frames from unrelated tools

#### Scenario: Delivered ticks stay within one window of the producer

- **GIVEN** a running subagent emitting ticks faster than the throttle window
- **WHEN** the Agent-tick frames DELIVERED to the client over the wire are
  inspected
- **THEN** the gap between consecutive delivered Agent ticks SHALL be within
  1.5 windows at p95 and within three windows at the maximum (scheduling jitter
  and GC pauses make an exact per-pair bound untestable), so a mid-run view is
  at most ~one window stale in the typical case

The assertion is made on the DELIVERED wire, NOT on the server's stored events:
the parent collapse change (`collapse-superseded-tool-execution-updates`) trims
superseded stored `tool_execution_update`s, so the stored sequence cannot carry
the cadence — a reload replays only a bounded handful of Agent ticks. The
throttle's staleness guarantee lives on the wire: its trailing timer delivers a
frame every ≤ one window while the producer is active, which bounds how stale a
mid-run view can get.

#### Scenario: No tick is delivered after the run's terminal event

- **GIVEN** a subagent run that ends while a coalesced tick is still pending
- **WHEN** the terminal `tool_execution_end` for that `toolCallId` is forwarded
- **THEN** no tick the throttle is holding for that `toolCallId` SHALL reach the
  client afterwards
- **AND** a page reload SHALL fold to the terminal state

The guarantee is scoped to frames the throttle holds. A producer emitting an
update AFTER its own terminal event is out of contract upstream, and suppressing
that would require an unbounded set of ended `toolCallId`s.

#### Scenario: Non-subagent tool updates are not throttled

- **GIVEN** a non-subagent tool streaming partial results
- **WHEN** its `tool_execution_update` events fire
- **THEN** every one SHALL be forwarded, unthrottled and uncoalesced

