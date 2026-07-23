## ADDED Requirements

### Requirement: Replay reconstructs persisted display-flagged custom messages
`replayEntriesAsEvents` SHALL synthesize events from persisted
`CustomMessageEntry` records so a display-flagged custom message rebuilds after
`/resume`, browser refresh, or dashboard server restart — matching the live path.

For each session entry where `entry.type === "custom_message"` AND `entry.display`
is truthy, replay SHALL emit a `message_start` followed by a `message_end`, each
carrying a message of shape `{ role: "custom", customType, content, display: true }`
along with `entryId` set to the entry's id, so the reducer rebuilds the same
assistant-side row it builds live.

A `custom_message` entry whose `display` is falsy or absent SHALL NOT emit any
event. This requirement applies only to `type:"custom_message"`; `type:"custom"`
(extension-state `CustomEntry`) handling is unchanged.

#### Scenario: Persisted display custom message replays to an assistant row
- **WHEN** a session JSONL contains a `type:"custom_message"` entry with `display: true`
- **THEN** replay SHALL emit a `message_start` and a `message_end` for it
- **AND** the reducer SHALL rebuild one `role:"assistant"` row carrying the entry's content

#### Scenario: Persisted hidden custom message is not replayed
- **WHEN** a session JSONL contains a `type:"custom_message"` entry with `display` falsy or absent
- **THEN** replay SHALL NOT emit any event for it

#### Scenario: Non-message custom entries remain ignored
- **WHEN** a session JSONL contains a `type:"custom"` entry whose `customType` is not `"flow-event"`
- **THEN** replay SHALL NOT emit an `event_forward` for it (unchanged behavior)
