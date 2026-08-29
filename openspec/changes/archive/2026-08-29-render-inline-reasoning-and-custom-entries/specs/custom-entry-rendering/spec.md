## ADDED Requirements

### Requirement: Custom entries SHALL reach the chat as first-class rows
The system SHALL forward non-`flow-event` custom content from both pi extension surfaces to the chat: `pi.sendMessage` custom messages (persisted as `custom_message` entries, arriving as `message_end` events with `message.role === "custom"`) and `pi.appendEntry` entries (persisted as `custom` entries, forwarded live by the bridge as `custom_entry` events). Both surfaces SHALL reduce into a common `role: "custom"` chat row instead of being dropped.

#### Scenario: sendMessage custom message renders as a row
- **WHEN** a `message_end` event arrives whose `message.role` is `"custom"` and `message.display` is `true`
- **THEN** the event reducer SHALL append a chat row with `role: "custom"`, the message's `customType`, and a display body derived from `message.content` (and `message.details` when present)

#### Scenario: appendEntry entry renders as a row
- **WHEN** the bridge receives a pi `entry_appended` event for a `type: "custom"` entry whose `customType` is not `flow-event`
- **THEN** it SHALL forward a `custom_entry` protocol event carrying `customType`, `data`, and `entryId`
- **AND** the event reducer SHALL append a `role: "custom"` chat row for it

#### Scenario: live flow-event appendEntry is not forwarded generically
- **WHEN** pi-flows appends a flow-event record via `pi.appendEntry("flow-event", …)` (firing `entry_appended` live)
- **THEN** the bridge SHALL NOT forward a `custom_entry` event for it
- **AND** the chat SHALL show only the dedicated flow card, not a generic custom card alongside it

#### Scenario: custom rows are not turn boundaries
- **WHEN** a `role: "custom"` row exists in the messages array
- **THEN** it SHALL NOT be classified as a hard turn boundary by the reducer's turn-scoped scans

### Requirement: display false custom messages SHALL stay invisible
Custom messages sent with `display: false` (LLM-context-only by contract) SHALL NOT render as chat rows, on both the live and replay paths.

#### Scenario: live display-false message produces no row
- **WHEN** a `message_end` event arrives whose `message.role` is `"custom"` and `message.display` is `false`
- **THEN** the event reducer SHALL NOT create a chat row

#### Scenario: display flag omitted means visible
- **WHEN** a custom message arrives with `display` absent or `undefined` (pi does not normalize the flag)
- **THEN** the message SHALL be treated as visible and render a chat row
- **AND** the exclusion SHALL be implemented as an exact `display === false` comparison, never a truthiness check

#### Scenario: replayed display-false entry produces no event
- **WHEN** state replay encounters a persisted `custom_message` entry with `display: false`
- **THEN** it SHALL NOT synthesize any event for it

### Requirement: Custom rows SHALL render as a bounded generic fallback
The chat SHALL render `role: "custom"` rows with a generic card showing the `customType` as a label and the payload as PLAIN TEXT (never markdown-interpreted), with the display body truncated to the same last-200-lines form the event store already enforces. Rendering SHALL be gated by the `customEntryFallback` preference (default `true`), applied at render time only.

#### Scenario: payload renders as plain text
- **WHEN** a `role: "custom"` row renders
- **THEN** the card SHALL show the `customType` label and the payload body as plain text
- **AND** the body SHALL NOT be passed through markdown rendering or linkification

#### Scenario: body is truncated to the display ceiling
- **WHEN** a custom payload exceeds 200 lines
- **THEN** the rendered body SHALL be the last 200 lines prefixed by the `«N earlier lines hidden»` marker, identical for live and replayed rows

#### Scenario: preference suppresses the fallback
- **WHEN** `customEntryFallback` is `false`
- **THEN** `role: "custom"` rows SHALL render nothing
- **AND** toggling the preference back SHALL make them visible again without a replay

### Requirement: flow-event entries keep their dedicated rendering
`customType: "flow-event"` entries SHALL continue down their existing dedicated path (seq-sorted flow-card reduction on replay, flow reducer live) and SHALL never be claimed by the generic custom-entry fallback.

#### Scenario: flow-event is not double-rendered
- **WHEN** state replay encounters a persisted `type: "custom"` entry with `customType: "flow-event"`
- **THEN** it SHALL synthesize the flow events per the existing seq-sorted behavior
- **AND** it SHALL NOT emit a `custom_entry` event for it

### Requirement: Custom entries survive replay
State replay (`replayEntriesAsEvents`) SHALL synthesize the same events for persisted custom content that the live path emits: `custom_message` entries with `display: true` replay as `message_end` events with `role: "custom"`, and non-`flow-event` `custom` entries replay as `custom_entry` events — so a reloaded session shows the same custom rows as the live view.

#### Scenario: reload reproduces custom rows
- **WHEN** a session containing custom messages and custom entries is cold-loaded or re-replayed
- **THEN** the rebuilt chat SHALL contain the same `role: "custom"` rows in their persisted order
