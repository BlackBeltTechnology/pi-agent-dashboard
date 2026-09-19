# custom-entry-rendering Specification

## Purpose
TBD - created by archiving change render-inline-reasoning-and-custom-entries. Update Purpose after archive.

## Requirements

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
The chat SHALL resolve a `role: "custom"` row's renderer as a chain: a matching
`custom-entry-renderer` plugin claim first, then the generic fallback card. The generic
fallback SHALL show the `customType` as a label and the payload as PLAIN TEXT (never
markdown-interpreted), with the display body truncated to the same last-200-lines form the
event store already enforces. Rendering SHALL be gated by the effective visibility of the
custom event group that the row's `customType` resolves to (first-match-wins, falling back to
the catch-all `other` group), applied at render time only. The same gate SHALL be applied
consistently at every site that decides whether a custom row is visible, so a hidden row is
excluded from row-visibility computations as well as from rendering, INCLUDING when the row has
been absorbed into a tool burst. The gate SHALL apply to plugin-claimed rows exactly as it
applies to fallback rows.

#### Scenario: payload renders as plain text
- **WHEN** a `role: "custom"` row renders via the generic fallback
- **THEN** the card SHALL show the `customType` label and the payload body as plain text
- **AND** the body SHALL NOT be passed through markdown rendering or linkification

#### Scenario: body is truncated to the display ceiling
- **WHEN** a custom payload exceeds 200 lines
- **THEN** the rendered body SHALL be the last 200 lines prefixed by the `«N earlier lines hidden»` marker, identical for live and replayed rows

#### Scenario: preference suppresses the fallback
- **GIVEN** a `role: "custom"` row whose `customType` resolves to group `memory`
- **WHEN** the effective visibility of `memory` is `false`
- **THEN** that row SHALL render nothing
- **AND** toggling the group back on SHALL make it visible again without a replay

#### Scenario: groups are independently gated
- **GIVEN** rows whose `customType` values resolve to different groups
- **WHEN** one group's visibility is `false` and another's is `true`
- **THEN** only the rows belonging to the hidden group SHALL be suppressed
- **AND** rows belonging to the visible group SHALL continue to render

#### Scenario: ungrouped type follows the catch-all
- **GIVEN** a `role: "custom"` row whose `customType` matches no configured group
- **WHEN** the effective visibility of the `other` group is `false`
- **THEN** that row SHALL render nothing

#### Scenario: plugin claim wins over the fallback
- **GIVEN** a plugin claims `custom-entry-renderer` for a row's `customType`
- **WHEN** that row renders
- **THEN** the plugin's component SHALL render it
- **AND** the generic fallback card SHALL NOT render for that row

#### Scenario: hidden group suppresses a claimed row too
- **GIVEN** a `role: "custom"` row that a plugin claims, whose group visibility is `false`
- **WHEN** the chat renders
- **THEN** the plugin's component SHALL NOT render
- **AND** the row SHALL be excluded from row-visibility computations

#### Scenario: gate holds for a row absorbed into a burst
- **GIVEN** a claimed custom row absorbed into a tool burst
- **WHEN** the burst is EXPANDED and that row's group visibility is `false`
- **THEN** the absorbed row SHALL render nothing inside the expanded burst

#### Scenario: absorbed row survives an empty container
- **GIVEN** a claimed custom row absorbed into a tool burst whose tool members are all hidden by
  the per-tool call visibility preference
- **WHEN** the chat renders and that row's own custom event group is visible
- **THEN** the row SHALL still render
- **AND** the container SHALL NOT suppress it merely because no tool member survived the
  per-tool gate

#### Scenario: absorbed row still renders when its group is visible
- **GIVEN** a claimed custom row absorbed into a tool burst
- **WHEN** the burst is EXPANDED and that row's group visibility is `true`
- **THEN** the plugin's component SHALL render for that row inside the expanded burst
- **AND** it SHALL offer the same collapsed presentation and expand affordance it offers at top
  level, so absorption changes a row's POSITION and never its content

### Requirement: flow-event entries keep their dedicated rendering
`customType: "flow-event"` entries SHALL continue down their existing dedicated path (seq-sorted flow-card reduction on replay, flow reducer live) and SHALL never be claimed by the generic custom-entry fallback, and SHALL never be gated by a custom event group toggle.

#### Scenario: flow-event is not double-rendered
- **WHEN** state replay encounters a persisted `type: "custom"` entry with `customType: "flow-event"`
- **THEN** it SHALL synthesize the flow events per the existing seq-sorted behavior
- **AND** it SHALL NOT emit a `custom_entry` event for it

#### Scenario: flow cards ignore group visibility
- **GIVEN** every custom event group is toggled off
- **WHEN** the chat renders a flow card
- **THEN** the flow card SHALL still render

### Requirement: Custom entries survive replay
State replay (`replayEntriesAsEvents`) SHALL synthesize the same events for persisted custom content that the live path emits: `custom_message` entries whose `display` is not exactly `false` (the same exact-comparison rule as the live path, so an omitted flag replays visible) replay as `message_end` events with `role: "custom"`, and non-`flow-event` `custom` entries replay as `custom_entry` events — so a reloaded session shows the same custom rows as the live view.

#### Scenario: reload reproduces custom rows
- **WHEN** a session containing custom messages and custom entries is cold-loaded or re-replayed
- **THEN** the rebuilt chat SHALL contain the same `role: "custom"` rows in their persisted order

### Requirement: Custom event group toggles SHALL appear in both display surfaces
Both display-preference surfaces — the global settings panel and the per-session chat view menu — SHALL render one
toggle per configured custom event group, labelled with the group's configured label, in the configured group order,
including the catch-all `other` group. No additional surface (inline click-to-hide, per-`customType` control) SHALL be
introduced. The per-session surface SHALL show its existing "overridden" indicator when a group's value comes from the
session override rather than the global value.

#### Scenario: Both surfaces list every configured group
- **WHEN** either the global settings panel or the per-session chat view menu renders its display-preferences section
- **THEN** it SHALL list one toggle per configured group, including `other`, in configured order

#### Scenario: Global toggle applies with no session selected
- **GIVEN** no session is selected
- **WHEN** the user toggles a group off in the global settings panel
- **THEN** the change SHALL persist globally
- **AND** SHALL apply to sessions that have no override for that group

#### Scenario: Per-session toggle overrides only that group
- **GIVEN** a global value for group `memory`
- **WHEN** the user toggles `memory` in the per-session chat view menu
- **THEN** only that session's effective `memory` visibility SHALL change
- **AND** every other group in that session SHALL continue to follow the global value
- **AND** the surface SHALL indicate that the value is overridden for this session

#### Scenario: Legacy single custom-entry toggle is gone
- **WHEN** either surface renders its display-preferences section after upgrade
- **THEN** no single combined "custom entries in chat" toggle SHALL be present
- **AND** its behavior SHALL be reachable through the `other` group toggle

### Requirement: A failing plugin renderer SHALL degrade to the generic fallback

A `custom-entry-renderer` component that throws during render SHALL NOT break the transcript.
The system SHALL contain the failure per row and SHALL render the generic fallback card in its
place, so a custom row is never reduced to a blank space or an error screen.

#### Scenario: Throwing renderer falls back

- **GIVEN** a plugin claims a `customType` and its component throws on render
- **WHEN** the chat renders that row
- **THEN** the generic fallback card SHALL render in its place
- **AND** surrounding rows SHALL render normally

### Requirement: Claimed renderers SHALL NOT fetch payloads until expanded

A plugin renderer's collapsed presentation SHALL be derivable from the chat row alone. The
system SHALL NOT issue a payload request for a custom row that is rendered but not expanded, so
a transcript containing thousands of claimed rows costs no additional requests at rest.

#### Scenario: Collapsed rows issue no requests

- **GIVEN** a transcript containing claimed custom rows, none expanded
- **WHEN** the chat renders
- **THEN** no custom-entry payload request SHALL be issued

#### Scenario: Expansion issues exactly one request

- **WHEN** the user expands a single claimed custom row that carries an entry id
- **THEN** exactly one payload request SHALL be issued, for that row's entry

#### Scenario: Row without an entry id offers no expand affordance

- **GIVEN** a claimed custom row carrying no entry id (the reducer does not stamp one on custom
  rows originating from a custom message rather than an appended entry)
- **WHEN** the row renders
- **THEN** the collapsed presentation SHALL render normally
- **AND** the row SHALL NOT offer an expand affordance, rather than offering one whose request
  can never be issued

#### Scenario: Collapsed summary never reports a partial count

- **GIVEN** a claimed custom row carrying an entry id, whose stored body was truncated and cannot
  be parsed as a complete payload
- **WHEN** the collapsed presentation renders
- **THEN** it SHALL NOT display a count or summary derived from the partial body
- **AND** it SHALL still offer the expand affordance

### Requirement: Payload unavailability SHALL degrade to the stored body

When an expanded renderer cannot obtain the structured payload — because the entry was evicted,
or the request failed — the system SHALL present the row's stored truncated body as plain text.
Expansion SHALL therefore never show less than the generic fallback already shows.

#### Scenario: Evicted entry falls back to the stored body

- **GIVEN** a claimed custom row whose entry is no longer retrievable
- **WHEN** the user expands it
- **THEN** the stored truncated body SHALL render as plain text
- **AND** no markdown rendering or linkification SHALL be applied to it
