# Spec Delta

## MODIFIED Requirements

### Requirement: flow-event entries keep their dedicated rendering
Custom entry types a plugin declares via `replayEntryTypes` (see `plugin-entry-replay`) SHALL be excluded from generic custom-entry rendering: they SHALL never be claimed by the generic custom-entry fallback and SHALL never be gated by a custom event group toggle. `flow-event` is the flows plugin's declared type; its entries replay seq-ordered as `flow_*` events and render as flow cards.

#### Scenario: flow-event is not double-rendered
- **GIVEN** the flows plugin is enabled and declares `flow-event`
- **WHEN** state replay encounters a persisted `type: "custom"` entry with `customType: "flow-event"`
- **THEN** it SHALL synthesize the recorded flow events seq-ordered per `plugin-entry-replay`
- **AND** it SHALL NOT emit a `custom_entry` event for it

#### Scenario: Any declared type is excluded generically
- **GIVEN** a plugin declares `replayEntryTypes: ["my-ext:run"]`
- **WHEN** a `my-ext:run` entry is replayed or appended live
- **THEN** no generic custom card SHALL render for it

#### Scenario: flow cards ignore group visibility
- **GIVEN** every custom event group is toggled off
- **WHEN** the chat renders a flow card
- **THEN** the flow card SHALL still render

### Requirement: Custom entries SHALL reach the chat as first-class rows
The system SHALL forward custom content whose type is not a plugin-declared replay entry type (`replayEntryTypes`, e.g. the flows plugin's `flow-event`) from both pi extension surfaces to the chat: `pi.sendMessage` custom messages (persisted as `custom_message` entries, arriving as `message_end` events with `message.role === "custom"`) and `pi.appendEntry` entries (persisted as `custom` entries, forwarded live by the bridge as `custom_entry` events). Both surfaces SHALL reduce into a common `role: "custom"` chat row instead of being dropped.

#### Scenario: sendMessage custom message renders as a row
- **WHEN** a `message_end` event arrives whose `message.role` is `"custom"` and `message.display` is `true`
- **THEN** the event reducer SHALL append a chat row with `role: "custom"`, the message's `customType`, and a display body derived from `message.content` (and `message.details` when present)

#### Scenario: appendEntry entry renders as a row
- **WHEN** the bridge receives a pi `entry_appended` event for a `type: "custom"` entry whose `customType` is not a declared replay entry type
- **THEN** it SHALL forward a `custom_entry` protocol event carrying `customType`, `data`, and `entryId`
- **AND** the event reducer SHALL append a `role: "custom"` chat row for it

#### Scenario: live flow-event appendEntry is not forwarded generically
- **WHEN** pi-flows appends a flow-event record via `pi.appendEntry("flow-event", …)` (firing `entry_appended` live)
- **THEN** the bridge SHALL NOT forward a `custom_entry` event for it
- **AND** the chat SHALL show only the dedicated flow card, not a generic custom card alongside it

#### Scenario: custom rows are not turn boundaries
- **WHEN** a `role: "custom"` row exists in the messages array
- **THEN** it SHALL NOT be classified as a hard turn boundary by the reducer's turn-scoped scans

### Requirement: Custom entries survive replay
State replay (`replayEntriesAsEvents`) SHALL synthesize the same events for persisted custom content that the live path emits: `custom_message` entries whose `display` is not exactly `false` (the same exact-comparison rule as the live path, so an omitted flag replays visible) replay as `message_end` events with `role: "custom"`, and `custom` entries whose type is not a plugin-declared replay entry type (`replayEntryTypes`) replay as `custom_entry` events — so a reloaded session shows the same custom rows as the live view.

#### Scenario: reload reproduces custom rows
- **WHEN** a session containing custom messages and custom entries is cold-loaded or re-replayed
- **THEN** the rebuilt chat SHALL contain the same `role: "custom"` rows in their persisted order

