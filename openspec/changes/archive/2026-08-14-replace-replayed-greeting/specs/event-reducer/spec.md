## ADDED Requirements

### Requirement: Greeting custom message is a singleton replacement
A `role:"custom"` message with `customType:"ib-greeting"` and `display:true` SHALL build
a single `ChatMessage` row keyed by a STABLE id `custom-ib-greeting` (not
`custom-<entryId>`), so a newer greeting REPLACES the prior greeting in place rather than
appending a new history row. The latest greeting's content SHALL win, and the row SHALL
retain the latest entry's `entryId`. Other `role:"custom"` messages (any `customType`
other than `"ib-greeting"`) SHALL keep their per-entry id and are NOT collapsed. A
`role:"custom"` message whose `display` is falsy or absent SHALL still produce no row.

#### Scenario: Newer greeting replaces the prior greeting in place
- **WHEN** a `message_end` for `role:"custom"`, `customType:"ib-greeting"`, `display:true`
  with content A arrives, followed by another with content B
- **THEN** `messages` SHALL contain exactly one greeting row
- **AND** its content SHALL be B (the latest)
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
