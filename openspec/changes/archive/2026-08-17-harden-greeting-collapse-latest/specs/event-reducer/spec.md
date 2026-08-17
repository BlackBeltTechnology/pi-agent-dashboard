## MODIFIED Requirements

### Requirement: Greeting custom message is a singleton replacement
A `role:"custom"` message with `customType:"ib-greeting"` and `display:true` SHALL build
a single `ChatMessage` row keyed by a STABLE id `custom-ib-greeting` (not
`custom-<entryId>`), so a newer greeting REPLACES the prior greeting in place rather than
appending a new history row. The latest greeting's content SHALL win, and the row SHALL
retain the latest entry's `entryId`. The collapse SHALL be monotonic in event timestamp:
a greeting `message_end` whose event timestamp is OLDER than the shown greeting row's
timestamp SHALL NOT overwrite it, so the NEWEST greeting wins regardless of event ARRIVAL
order (a stale replay-snapshot greeting arriving after a newer live greeting SHALL be
ignored). An equal timestamp SHALL still replace (idempotent re-replay of the same state).
The greeting row SHALL carry the timestamp of the greeting event that produced its current
content, advanced on every accepted replacement. Other `role:"custom"` messages (any
`customType` other than `"ib-greeting"`) SHALL keep their per-entry id, are NOT collapsed,
and are NOT subject to the timestamp guard. A `role:"custom"` message whose `display` is
falsy or absent SHALL still produce no row.

#### Scenario: Newer greeting replaces the prior greeting in place
- **WHEN** a `message_end` for `role:"custom"`, `customType:"ib-greeting"`, `display:true`
  with content A arrives, followed by another with content B at an equal-or-newer timestamp
- **THEN** `messages` SHALL contain exactly one greeting row
- **AND** its content SHALL be B (the latest)
- **AND** its id SHALL be `custom-ib-greeting`

#### Scenario: A stale greeting arriving after a newer one does not overwrite it
- **WHEN** a `message_end` `ib-greeting` with content B and timestamp T2 arrives
- **AND** a later `message_end` `ib-greeting` with content A and an OLDER timestamp T1 (T1 < T2) arrives
- **THEN** `messages` SHALL contain exactly one greeting row
- **AND** its content SHALL remain B (the newest), not the stale A
- **AND** its id SHALL be `custom-ib-greeting`

#### Scenario: Unrelated custom messages are not collapsed
- **WHEN** two `ib-greeting` messages (A then B) and one `customType:"x-note"` message
  arrive in any order
- **THEN** `messages` SHALL contain one greeting row (content B) and one separate
  `x-note` row, each with distinct ids

#### Scenario: Hidden greeting produces no row
- **WHEN** a `role:"custom"`, `customType:"ib-greeting"` message with `display` falsy or
  absent arrives
- **THEN** no `ChatMessage` SHALL be added to `messages`
