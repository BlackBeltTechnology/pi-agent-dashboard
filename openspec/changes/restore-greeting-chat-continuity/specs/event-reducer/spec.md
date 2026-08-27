# event-reducer Specification (delta)

## RENAMED Requirements

- FROM: `### Requirement: Greeting custom message is a singleton replacement`
- TO: `### Requirement: Greeting custom message is a chronological chat row`

## MODIFIED Requirements

### Requirement: Greeting custom message is a chronological chat row
A `role:"custom"` message with `customType:"ib-greeting"` and `display:true` SHALL build
its OWN `ChatMessage` row keyed by a per-entry id (derived from the entry's `entryId`,
exactly as every other `role:"custom"` message is keyed), appended as it is reduced rather
than collapsed into a single shared row. Multiple greetings SHALL therefore produce
multiple rows, one per greeting, in chronological (session `seq`) order — a greeting is
chat history, not a singleton replacement. The greeting branch SHALL NOT itself sort or
reposition rows and SHALL NOT arbitrate distinct greetings by timestamp; it SHALL rely on
the established per-session `seq`-ordered delivery guarantee that already orders every
other row type, namely: replay batches are reduced in ascending `seq`, live events are
`seq`-sorted before reduce, replay/live interleave is suppressed during a replay sweep, and
a re-replay sweep whose first `seq` is `<= maxSeq` resets state and rebuilds every row in
`seq` order. Because of that guarantee the reducer only ever observes greetings in
ascending `seq` (= chronological) order within any surviving state, so plain append yields
chronological rows even when a re-replay lands after a newer live greeting. A greeting
delivery whose per-entry id already matches a shown greeting row (a re-replay or a late
duplicate of the SAME entry) SHALL replace that row in place rather than append a second
row, so a re-replay sweep never duplicates greeting rows. Distinct greetings (different
entry ids) SHALL NOT overwrite each other and SHALL NOT be subject to any
timestamp-arbitration guard. Other `role:"custom"` messages (any `customType` other than
`"ib-greeting"`) SHALL keep their per-entry id and their existing behaviour, unchanged. A
`role:"custom"` message whose `display` is falsy or absent SHALL still produce no row.

#### Scenario: Multiple greetings append as separate rows in order
- **WHEN** a `message_end` for `role:"custom"`, `customType:"ib-greeting"`, `display:true`
  with content A arrives, followed by another with content B, then another with content C
- **THEN** `messages` SHALL contain three greeting rows
- **AND** their contents SHALL be A, B, C in that order
- **AND** each row SHALL carry its own per-entry id

#### Scenario: Re-replaying the same greeting does not duplicate its row
- **WHEN** an `ib-greeting` `message_end` with entry id `g1` and content A arrives
- **AND** the same `ib-greeting` `message_end` with entry id `g1` arrives again (re-replay)
- **THEN** `messages` SHALL contain exactly one greeting row for `g1`
- **AND** its content SHALL be A

#### Scenario: A late duplicate of a shown greeting does not add a row
- **WHEN** greetings `g1` (content A) then `g2` (content B) arrive as two rows
- **AND** a duplicate delivery of `g1` (content A) arrives late
- **THEN** `messages` SHALL still contain exactly two greeting rows (A then B)
- **AND** no third greeting row SHALL be added

#### Scenario: A re-replay sweep after a live greeting rebuilds all greetings in order
- **WHEN** a live `ib-greeting` `message_end` with entry id `g3` (highest `seq`, content C)
  has already produced a row
- **AND** a full re-replay sweep then arrives whose first event `seq` is `<= maxSeq`,
  carrying `g1` (content A), `g2` (content B), `g3` (content C) in ascending `seq`
- **THEN** the reset-and-rebuild path SHALL wipe state and rebuild the greeting rows in
  `seq` order
- **AND** the rendered greeting rows SHALL be A, B, C in that order (never C, A, B)
- **AND** there SHALL be exactly three greeting rows

#### Scenario: Unrelated custom messages are not affected
- **WHEN** two `ib-greeting` messages (A then B) and one `customType:"x-note"` message
  arrive in any order
- **THEN** `messages` SHALL contain two greeting rows (A and B) and one separate
  `x-note` row, each with distinct ids

#### Scenario: Hidden greeting produces no row
- **WHEN** a `role:"custom"`, `customType:"ib-greeting"` message with `display` falsy or
  absent arrives
- **THEN** no `ChatMessage` SHALL be added to `messages`
