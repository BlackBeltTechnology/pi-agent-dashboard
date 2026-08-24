<!--
ORDERING: these deltas assume `fix-lazy-history-backfill-ux` is archived first.
That change does not touch the three requirements below, so they apply cleanly
against today's main spec either way.
-->

## ADDED Requirements

### Requirement: A windowed replay announces its shape

The gap announcement SHALL carry the shape of the window that produced it, so the client can determine whether the elided region is bounded above without inferring it from a numeric bound. The field SHALL be additive and optional: a client that does not read it SHALL behave as though the shape were `head-tail`, which is what a server that has not opted in always produces.

#### Scenario: Shape accompanies the gap announcement

- **WHEN** a window is applied and the gap is announced
- **THEN** the announcement SHALL state whether the window has a head segment

#### Scenario: The shape is not inferred from the head bound

- **WHEN** a client determines whether to floor its requests, to auto-load on scroll, or to resolve exhaustion to a terminus
- **THEN** it SHALL consult the announced shape
- **AND** it SHALL NOT derive the shape from `headMaxSeq` being `0`

#### Scenario: An older client degrades to the default shape

- **WHEN** a client that does not read the shape field receives an announcement carrying it
- **THEN** the client SHALL continue to behave as it does for a `head-tail` window
- **AND** no field it already reads SHALL have changed name or type

## MODIFIED Requirements

### Requirement: Subscribe-time replay MAY be bounded to a configured window

When `memoryLimits.maxReplayEvents` is greater than zero, the server SHALL deliver at most that many events per full-stream subscription. The delivered shape SHALL be determined by `memoryLimits.replayWindowMode`: in `head-tail` a head segment plus a tail segment with an elided middle; in `tail-only` a tail segment alone, with the elided region unbounded above. When `maxReplayEvents` is zero, replay SHALL be unbounded, `replayWindowMode` SHALL have no effect, and behavior SHALL be identical to the prior implementation.

#### Scenario: Windowing disabled by default

- **WHEN** `maxReplayEvents` is `0` and a client subscribes to a session with 50000 stored events
- **THEN** the server SHALL replay all 50000 events
- **AND** the server SHALL NOT emit a `history_window` message carrying a non-zero `gapCount`

#### Scenario: Window applied to a full stream in `head-tail`

- **WHEN** `maxReplayEvents` is `500`, `replayWindowMode` is `head-tail`, and a client subscribes with `lastSeq: 0` to a session whose compacted stream holds 5000 events
- **THEN** the server SHALL deliver at most 500 events
- **AND** the delivered events SHALL comprise a head segment beginning at the lowest stored seq and a tail segment ending at the highest stored seq

#### Scenario: Window applied to a full stream in `tail-only`

- **WHEN** `maxReplayEvents` is `500`, `replayWindowMode` is `tail-only`, and a client subscribes with `lastSeq: 0` to a session whose compacted stream holds 5000 events
- **THEN** the server SHALL deliver at most 500 events
- **AND** the delivered events SHALL comprise a tail segment alone, ending at the highest stored seq
- **AND** no delivered event SHALL precede the tail segment
- **AND** the announced `headMaxSeq` SHALL be `0`

#### Scenario: `tail-only` is inert when windowing is off

- **WHEN** `replayWindowMode` is `tail-only` and `maxReplayEvents` is `0`
- **THEN** the server SHALL replay the full stream
- **AND** the server SHALL NOT emit a `history_window` message carrying a non-zero `gapCount`

#### Scenario: Session smaller than the window is delivered whole

- **WHEN** `maxReplayEvents` is `1000` and the compacted stream holds 40 events
- **THEN** the server SHALL deliver all 40 events exactly once
- **AND** the server SHALL NOT emit a `history_window` message at all, because no window was applied
- **AND** no event SHALL appear more than once in the delivered stream

### Requirement: A windowed replay resets client state explicitly

When a window is applied to a full-stream replay, the server SHALL send `session_state_reset` before the replay, on EVERY path that can deliver a windowed full stream — the warm-store subscribe, the stale-`lastSeq` re-replay, and the cold disk-hydration fan-out. The reset SHALL NOT depend on the delivered stream beginning at seq `1`, because a `tail-only` window never delivers seq `1`.

#### Scenario: Reset precedes a windowed replay

- **WHEN** a window is applied for a client subscribing with `lastSeq: 0`
- **THEN** the client SHALL receive `session_state_reset` before the first delivered event
- **AND** the resulting transcript SHALL contain no rows from a prior subscription

#### Scenario: Cold hydration resets before a windowed fan-out

- **WHEN** a session is hydrated from disk and its stored stream exceeds the configured window
- **THEN** every subscriber SHALL receive `session_state_reset` before the first delivered event of the hydration replay

#### Scenario: A head-free window does not rely on the `firstSeq === 1` reduction rule

- **WHEN** `replayWindowMode` is `tail-only`, a client already holds transcript rows for the session, and a windowed replay is delivered whose first seq is greater than `1`
- **THEN** the prior rows SHALL be discarded rather than retained
- **AND** the delivered tail SHALL NOT be appended beneath stale rows

### Requirement: Window segment boundaries snap inward

The tail segment's leading edge SHALL snap forward to the next `message_start` or `turn_start` within a bounded lookup. When the window has a head segment, that segment's trailing edge SHALL snap backward to a completed `message_end` within the same bound; when the window has no head segment, no head-edge snap SHALL be attempted. Neither snap SHALL increase the number of delivered events beyond the configured limit.

#### Scenario: Delivered count never exceeds the configured limit

- **WHEN** `maxReplayEvents` is `500` and boundary snapping is applied
- **THEN** the number of delivered events SHALL be less than or equal to `500`

#### Scenario: Tail opens on a message boundary

- **WHEN** the computed tail cut falls in the middle of an assistant message and a `message_start` exists within the lookup bound
- **THEN** the first delivered tail event SHALL be that `message_start`

#### Scenario: A head-free window snaps only its tail edge

- **WHEN** `replayWindowMode` is `tail-only` and a window is applied
- **THEN** the tail's leading edge SHALL snap forward as normal
- **AND** no head-edge snap SHALL be performed
- **AND** the delivered count SHALL remain within the configured limit
