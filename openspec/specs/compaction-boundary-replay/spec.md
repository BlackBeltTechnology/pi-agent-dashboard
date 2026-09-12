# compaction-boundary-replay Specification

## Purpose
TBD - created by archiving change replay-compaction-boundary. Update Purpose after archive.

## Requirements

### Requirement: Persisted compaction entries replay as compaction boundaries

When rebuilding a session transcript from pi's persisted session entries, the replay converter SHALL synthesize, for every entry of type `compaction`, an event of the same type the bridge forwards on the live path (`session_compact`), carrying the entry's timestamp, so a compaction boundary rendered during a live session is still rendered when the transcript is rebuilt from persisted entries. Parity is on event type, position and timestamp; metadata follows the "Absent compaction metadata is not fabricated" requirement below and therefore need NOT match a live event's metadata.

The synthesized event SHALL be positioned at the compaction entry's own place in the entry sequence.

This SHALL hold for both producers of the replay converter: the server's cold load from a session file, and the bridge extension's replay of the session branch on register, reconnect, and fork/resume.

#### Scenario: Compaction entry produces a boundary row

- **WHEN** a session file contains a `compaction` entry between two message entries and the session is replayed from disk
- **THEN** the replay output SHALL contain a `session_compact` event between the events synthesized for those two messages
- **AND** reducing that output SHALL produce the same compaction boundary row that the live `session_compact` event produces

#### Scenario: Multiple compactions each produce a boundary

- **WHEN** a session file contains more than one `compaction` entry
- **THEN** the replay output SHALL contain one `session_compact` event per entry, in entry order

#### Scenario: Boundary survives a bridge reconnect replay

- **WHEN** the bridge replays a session branch containing a `compaction` entry after a reconnect
- **THEN** the forwarded event stream SHALL contain the corresponding `session_compact` event

#### Scenario: Session without compaction is unchanged

- **WHEN** a session file contains no `compaction` entry
- **THEN** the replay output SHALL be byte-identical to the output produced before this requirement existed

### Requirement: Absent compaction metadata is not fabricated

The persisted `compaction` entry carries no compaction `reason` and no `willRetry` flag. The replay converter SHALL NOT invent them: the synthesized event SHALL omit any metadata field the entry does not carry, which the reducer already treats as a metadata-free (legacy) compaction event.

The entry's `summary` field SHALL NOT be rendered as transcript content.

#### Scenario: Synthesized event carries no reason or willRetry

- **WHEN** a `compaction` entry is replayed
- **THEN** the synthesized `session_compact` event SHALL NOT contain `reason` or `willRetry`
- **AND** the reduced state's compaction metadata SHALL remain unset, exactly as for a legacy live event

#### Scenario: Summary text is not injected into the transcript

- **WHEN** a `compaction` entry with a multi-kilobyte `summary` is replayed
- **THEN** no transcript row SHALL contain that summary text

### Requirement: Cold replay and live streaming do not double-render a compaction

A compaction SHALL be rendered exactly once per session view. Synthesized compaction events SHALL be subject to the same register-time reset semantics as every other replayed event — store wipe plus client state reset, or replay-insert suppression — and the change SHALL NOT introduce a compaction-specific dedup path.

#### Scenario: Warm session keeps a single boundary

- **WHEN** a session compacts while it is being streamed live and the browser stays subscribed
- **THEN** exactly one compaction boundary row SHALL be present

#### Scenario: Reloaded session keeps a single boundary

- **WHEN** the same session is later reopened after its events were evicted and reloaded from disk
- **THEN** exactly one compaction boundary row SHALL be present

#### Scenario: Reconnect replay keeps a single boundary

- **WHEN** a session that already rendered a live compaction boundary reconnects, and the bridge replays its branch
- **THEN** exactly one compaction boundary row SHALL be present after the replay completes
