## MODIFIED Requirements

### Requirement: Write the full resolved config
`PUT /api/plugins/hermes-memory/config` SHALL accept a complete config object,
validate it, and on success write every field's effective value to the file as
pretty-printed (2-space) JSON, creating the parent directory if missing. Keys
present in the on-disk file but outside the known `MemoryConfig` field set
SHALL be preserved unchanged in the written file. The write SHALL be atomic
(write a temporary file in the same directory, then rename it into place).

#### Scenario: Successful save
- **WHEN** a valid config object is PUT and no file previously existed
- **THEN** the file is created at the resolved path containing all fields
- **AND** a subsequent GET reports `exists: true` with the saved values

#### Scenario: Atomic write leaves no partial file
- **WHEN** a save is performed
- **THEN** the final file appears via rename, never as a partially written file

#### Scenario: Unknown on-disk key survives a save
- **WHEN** the on-disk file contains `{ "futureHermesKey": 42 }` and a valid config object is PUT
- **THEN** the written file still contains `"futureHermesKey": 42`
- **AND** every known field carries the submitted value

## ADDED Requirements

### Requirement: Field set tracks the pinned pi-hermes-memory version
The plugin's re-declared `MemoryConfig` field set, enums and defaults SHALL
match `pi-hermes-memory@0.9.10` (`src/types.ts`, `src/config.ts`,
`src/constants.ts`), and a test SHALL assert `KNOWN_KEYS` equals a checked-in
upstream field-list fixture for that version.

#### Scenario: Newer field is editable
- **WHEN** the settings form loads
- **THEN** `lazyInitialization`, `flushCompactTimeoutMs`, `quickCheckOnOpen`, `llmFallbackModels`, `overflowGraceMs`, `consolidationChunking`, `consolidationChunkChars`, `usageHitTrackingEnabled`, `consolidationUsageSignals`, `autoConsolidationWarnOnFailure`, `standingInstructionsEnabled` and `sessionRetentionDays` each render with their 0.9.10 default

#### Scenario: Max thinking level accepted
- **WHEN** `llmThinkingOverride` is `"max"` in a PUT body
- **THEN** validation passes and the value is written

#### Scenario: Updated default reported
- **WHEN** `consolidationTimeoutMs` is absent from the on-disk file
- **THEN** GET reports its default as `180000` with `isDefault: true`

#### Scenario: Drift guard catches an unsynced field
- **WHEN** the fixture field list and `KNOWN_KEYS` differ
- **THEN** the drift-guard test fails naming the differing keys
