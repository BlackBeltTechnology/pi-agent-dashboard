# on-demand-session-replay Specification (delta)

## RENAMED Requirements

- FROM: `### Requirement: Replay emits a singleton current greeting`
- TO: `### Requirement: Replay emits every greeting chronologically`

## MODIFIED Requirements

### Requirement: Replay emits every greeting chronologically
A persisted `custom_message` entry with `customType:"ib-greeting"` SHALL replay as chat
history, not as a singleton current-state overlay. For a session whose JSONL contains one
or more such display-flagged entries, `replayEntriesAsEvents` SHALL emit one
`message_start` + `message_end` pair for EACH greeting entry, each at the entry's own
chronological position, interleaved with the surrounding entries — not one collapsed pair.
Greeting entries whose `display` is falsy or absent SHALL be ignored. Non-greeting
`custom_message` entries (`customType` other than `"ib-greeting"`) SHALL still each replay
their own `message_start` + `message_end` pair, unchanged. Each emitted greeting pair SHALL
carry `customType:"ib-greeting"` and that entry's own `entryId`, so the reducer rebuilds one
chat row per greeting and, because each id is stable across replays, a re-replay sweep maps
every greeting back onto its existing row without adding duplicate rows.

#### Scenario: Three historical greetings replay as three chronological greetings
- **WHEN** a session JSONL contains three `type:"custom_message"` entries with
  `customType:"ib-greeting"`, `display:true`, and content A, B, C in order
- **THEN** replay SHALL emit three `message_start` + `message_end` pairs
- **AND** they SHALL carry content A, B, C in that order
- **AND** each pair SHALL carry the `entryId` of its own greeting entry

#### Scenario: Greetings interleave with unrelated custom messages in order
- **WHEN** a session JSONL contains an `ib-greeting` entry, then a
  `type:"custom_message"` entry with `customType:"x-note"`, then another `ib-greeting`
  entry, all `display:true`
- **THEN** replay SHALL emit a greeting pair, then the `x-note` pair, then the second
  greeting pair, preserving JSONL order
- **AND** the `x-note` pair SHALL carry the `x-note` entry's content and `entryId`
- **AND** each greeting pair SHALL carry its own greeting entry's content and `entryId`

#### Scenario: No greeting leaves replay unchanged
- **WHEN** a session JSONL contains display-flagged custom messages but no
  `customType:"ib-greeting"` entry
- **THEN** replay SHALL emit a pair for every display-flagged custom message exactly as
  before, and no greeting-specific handling SHALL apply
