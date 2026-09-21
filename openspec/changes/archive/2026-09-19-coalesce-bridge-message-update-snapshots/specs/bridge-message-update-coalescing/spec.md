# bridge-message-update-coalescing

## Purpose

Bounds the bridge's per-token forwarding cost during assistant streaming by
coalescing contiguous full-text snapshots into one wire message per fixed
window, while preserving the exact source order of every non-text sub-event and
guaranteeing no snapshot can land after its message has closed.

## ADDED Requirements

### Requirement: Contiguous text snapshots SHALL coalesce into a fixed window

The bridge SHALL hold at most one pending text-carrying `message_update` at a
time and SHALL forward only the most recent one when the window elapses. The
window SHALL be a fixed 50 ms interval anchored at the arrival of the first
pending update, not a debounce restarted by each subsequent update, so a
continuous token stream is never starved and stays at most one window behind the
source.

Text-carrying updates are those whose assistant sub-event is `text_start`,
`text_delta` or `text_end`.

#### Scenario: Last snapshot wins within a window

- **WHEN** several `text_delta` updates for the same open message arrive inside
  one 50 ms window
- **THEN** exactly one `message_update` is forwarded for that window
- **AND** it carries the newest accumulated snapshot, not an earlier one

#### Scenario: Fixed window, not a debounce

- **WHEN** text updates keep arriving faster than the window length, without a
  gap, for longer than one window
- **THEN** a snapshot is forwarded every window
- **AND** no snapshot is delayed by more than one window past its arrival

#### Scenario: Idle stream forwards nothing

- **WHEN** the window elapses with no pending text update
- **THEN** no `message_update` is forwarded

### Requirement: Non-text sub-events SHALL be forwarded immediately in source order

The bridge SHALL forward any `message_update` whose sub-event is not
text-carrying — `thinking_start`, `thinking_delta`, `thinking_end`,
`toolcall_start`, `toolcall_delta`, `toolcall_end`, `start`, and any sub-event
type the bridge does not recognise — immediately and without coalescing, after
first flushing any pending text snapshot. No thinking or toolcall sub-event of a
still-open message SHALL be dropped or reordered relative to the text around it.
Sub-events of a message the bridge has already closed are governed by the
closed-message requirement below.

#### Scenario: Thinking deltas are lossless

- **WHEN** a run of `thinking_delta` updates arrives
- **THEN** every one of them is forwarded
- **AND** none is replaced by a later one

#### Scenario: Pending text flushes before a thinking update

- **WHEN** a text snapshot is pending and a `thinking_delta` arrives before the
  window elapses
- **THEN** the pending text snapshot is forwarded first
- **AND** the thinking update is forwarded immediately after it

#### Scenario: Unknown sub-event type is passed through

- **WHEN** a `message_update` carries a sub-event type the bridge does not
  recognise
- **THEN** any pending text is flushed first
- **AND** the update is forwarded immediately, unmodified

#### Scenario: Text preceding a tool execution survives

- **WHEN** text snapshots are pending and a `tool_execution_start` is handled
- **THEN** the newest text snapshot is on the wire immediately before it
- **AND** the server's replay compaction still finds a text-bearing
  `message_update` preceding that `tool_execution_start`

### Requirement: A pending snapshot SHALL precede every non-update event of its message

The bridge SHALL flush any pending text snapshot before forwarding, deferring,
or early-returning from any event other than `message_update`. This includes
`message_start`, `message_end`, `turn_end`, `agent_end`, `agent_settled`,
tool-execution events, model/thinking-level selection, and pass-through events.

#### Scenario: No snapshot lands after message_end

- **WHEN** a text snapshot is still pending and `message_end` for that message
  is handled
- **THEN** the pending snapshot is on the wire before the `message_end`
- **AND** no `message_update` for that message is forwarded afterwards

#### Scenario: Early-returning handler still flushes

- **WHEN** a non-`message_update` event is handled on a branch that returns
  without forwarding anything
- **THEN** any pending text snapshot has still been flushed

### Requirement: Updates for a closed message SHALL be dropped, and only those

The bridge SHALL track message identity across `message_start` and
`message_end`. Any `message_update` belonging to an identity the bridge has
already closed SHALL be discarded rather than forwarded. Every other update
SHALL be handled normally, opening a new identity when none is open or when the
update belongs to an identity the bridge never saw open — so no unanticipated
stream is silently swallowed. The identity SHALL be derived from data that is
stable for the whole message lifetime and unique across messages, and SHALL NOT
rely on a persisted message id, which is not available while the message
streams.

#### Scenario: Straggler from a finished message is dropped

- **WHEN** a text snapshot for message A is still pending, message A ends, and
  message B starts before the window elapses
- **THEN** no snapshot belonging to message A is forwarded after message B's
  `message_start`

#### Scenario: Update with no open message opens one

- **WHEN** a `message_update` arrives while no message is open, because the
  bridge was re-initialised by an extension reload during a live turn
- **THEN** the update is coalesced or forwarded under its own identity
- **AND** it is not discarded

#### Scenario: New turn supersedes the previous identity

- **WHEN** a new user or assistant message opens while a previous message's
  snapshot is pending
- **THEN** the previous message's pending snapshot is either flushed before the
  new `message_start` or dropped
- **AND** it is never forwarded after the new `message_start`

### Requirement: Lifecycle boundaries SHALL NOT reorder message content

The bridge SHALL flush pending text before a transport reconnect performs state
sync and history replay, so live content can never appear after replayed
history. The bridge SHALL discard pending text and cancel any armed window on
session switch, session shutdown, and extension reload, so no snapshot crosses a
session boundary.

#### Scenario: Reconnect flushes before replay

- **WHEN** the bridge reconnects to the dashboard with a text snapshot pending
- **THEN** the snapshot is forwarded before the state-sync and replay messages

#### Scenario: Session switch discards pending text

- **WHEN** the session changes or the extension reloads with a snapshot pending
- **THEN** the pending snapshot is discarded and its window cancelled
- **AND** no `message_update` for the previous session is forwarded afterwards

### Requirement: Forwarded snapshot payloads SHALL be unchanged in shape

A coalesced `message_update` SHALL be byte-identical in shape to the one the
bridge forwards today, including any assistant-image inlining applied to it.
Consumers SHALL require no protocol change. Image inlining SHALL run once per
forwarded snapshot rather than once per source update.

Because these snapshots are cumulative, a forwarded snapshot MAY carry content
that accumulated after the update it represents. It SHALL NOT carry less content
than that update, and it SHALL NOT be forwarded at all once its message is
closed.

#### Scenario: Forwarded snapshot never loses content

- **WHEN** a pending text snapshot is superseded and later flushed
- **THEN** the forwarded payload carries at least the accumulated text of the
  newest update it represents
- **AND** no earlier, shorter snapshot is forwarded after a newer one

#### Scenario: Client renders coalesced stream identically

- **WHEN** a turn streams with coalescing enabled
- **THEN** the final rendered assistant text equals the full accumulated text
- **AND** no ghost streaming bubble remains after the turn settles
