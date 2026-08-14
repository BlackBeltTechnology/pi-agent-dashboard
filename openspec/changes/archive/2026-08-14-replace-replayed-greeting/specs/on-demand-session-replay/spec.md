## ADDED Requirements

### Requirement: Replay emits a singleton current greeting
A persisted `custom_message` entry with `customType:"ib-greeting"` SHALL replay as a
singleton current-state overlay, not as chat history. For a session whose JSONL contains
one or more such display-flagged entries, `replayEntriesAsEvents` SHALL emit exactly one
`message_start` + `message_end` pair carrying the LATEST entry's content, positioned at
the slot of the FIRST greeting entry so the greeting stays the opener. Earlier greeting
entries SHALL NOT emit any event. Greeting entries whose `display` is falsy or absent
SHALL be ignored. Non-greeting `custom_message` entries (`customType` other than
`"ib-greeting"`) SHALL still each replay their own `message_start` + `message_end` pair,
unchanged. The emitted greeting events SHALL carry `customType:"ib-greeting"` and the
latest entry's `entryId`, so the reducer rebuilds the same singleton row live and replay.

#### Scenario: Three historical greetings replay as one latest greeting
- **WHEN** a session JSONL contains three `type:"custom_message"` entries with
  `customType:"ib-greeting"`, `display:true`, and content A, B, C in order
- **THEN** replay SHALL emit exactly one `message_start` and one `message_end` for the
  greeting
- **AND** both SHALL carry content C (the latest)
- **AND** the emitted events SHALL carry `entryId` equal to the latest greeting's id

#### Scenario: Unrelated custom messages replay unchanged
- **WHEN** a session JSONL contains two `ib-greeting` entries and one
  `type:"custom_message"` entry with `customType:"x-note"`, all `display:true`
- **THEN** replay SHALL emit one greeting pair (latest greeting content) plus one
  `x-note` pair
- **AND** the `x-note` pair SHALL carry the `x-note` entry's content and `entryId`

#### Scenario: No greeting leaves replay unchanged
- **WHEN** a session JSONL contains display-flagged custom messages but no
  `customType:"ib-greeting"` entry
- **THEN** replay SHALL emit a pair for every display-flagged custom message exactly as
  before, and no greeting singleton handling SHALL apply
