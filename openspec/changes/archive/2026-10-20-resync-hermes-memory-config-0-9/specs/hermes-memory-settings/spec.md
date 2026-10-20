## MODIFIED Requirements

### Requirement: Read effective config with per-field defaults
`GET /api/plugins/hermes-memory/config` SHALL return the resolved file path, a
file-level `exists` flag, a `raw` resolved config object, and a `fields` map
where each known `MemoryConfig` key carries `value` (the on-disk value when
present, else the default), `default` (the built-in default), and `isDefault`
(true when the key is absent from the on-disk file, except for the derived
fields whose `isDefault` follows the derivation rules below). `raw` SHALL also contain
every on-disk key outside the known field set, with its on-disk value; `fields`
SHALL contain known keys only. `raw` is display-only and SHALL NOT be assumed
to be a valid PUT body.

These upstream (`pi-hermes-memory@0.9.10` `loadConfig`) derivations SHALL be
mirrored in `fields`:
- When the file has no `memoryOverflowStrategy` but a boolean
  `autoConsolidate`, `fields.memoryOverflowStrategy` SHALL report
  `"auto-consolidate"` when it is `true`, else `"reject"`, with
  `isDefault: false`.
- When a valid `memoryOverflowStrategy` is on disk, `fields.autoConsolidate`
  SHALL report `strategy === "auto-consolidate"`; its `isDefault` SHALL be
  `true` only when `autoConsolidate` is absent from the file and the derived
  value equals its default, otherwise `false`.
- When `llmModelOverride` is an array of strings, `fields.llmModelOverride`
  SHALL report its first trimmed non-empty entry. The remaining entries,
  together with the legacy alias keys `llmModelFallbacks` and
  `fallbackModels`, SHALL be unioned (deduplicated, in upstream order) into
  `fields.llmFallbackModels`. Every affected field reports `isDefault: false`.

A malformed or non-object file SHALL read as every field default. If the file
exists but cannot be read (any error other than `ENOENT`), GET SHALL respond
HTTP 500 with `{ error, code }`.

#### Scenario: File present with one overridden field
- **WHEN** the file contains `{ "llmModelOverride": "anthropic/claude-haiku-4-5" }`
- **THEN** `fields.llmModelOverride` is `{ value: "anthropic/claude-haiku-4-5", default: <unset-default>, isDefault: false }`
- **AND** every other field reports its default with `isDefault: true`
- **AND** `exists` is `true`

#### Scenario: File absent
- **WHEN** no config file exists at the resolved path
- **THEN** the response has `exists: false`
- **AND** every field reports its default with `isDefault: true`

#### Scenario: Legacy autoConsolidate-only file derives the strategy
- **WHEN** the file contains `{ "autoConsolidate": false }`
- **THEN** `fields.memoryOverflowStrategy` is `{ value: "reject", isDefault: false }`

#### Scenario: Array-form model override is normalized
- **WHEN** the file contains `{ "llmModelOverride": ["a/b", "c/d"] }`
- **THEN** `fields.llmModelOverride.value` is `"a/b"`
- **AND** `fields.llmFallbackModels.value` is `["c/d"]`
- **AND** saving the form unchanged returns HTTP 200

#### Scenario: Unreadable file on GET
- **WHEN** the file exists but reading it fails with a non-`ENOENT` error
- **THEN** GET responds HTTP 500 with `{ error, code }`

#### Scenario: Unknown on-disk key visible in raw only
- **WHEN** the file contains `{ "futureHermesKey": 42 }`
- **THEN** `raw.futureHermesKey` is `42`
- **AND** `fields` has no `futureHermesKey` entry

### Requirement: Write the full resolved config
`PUT /api/plugins/hermes-memory/config` SHALL accept a complete config object,
validate it, and on success write it to the file as pretty-printed (2-space)
JSON, creating the parent directory if missing. The written object SHALL be
composed as follows:
- (a) every on-disk key outside the known `MemoryConfig` field set, copied with
  its on-disk value;
- (b) every submitted known field, except a field whose value equals its
  built-in default and an empty `llmFallbackModels` array; both SHALL be
  omitted. `memoryOverflowStrategy` is exempt
  and is always written when submitted;
- (c) a known key absent from the submitted object SHALL NOT be carried over
  from the on-disk file.

When the on-disk file contains every key that had a built-in default in the
0.8.1 mirror, and both its `consolidationTimeoutMs` and the submitted
`consolidationTimeoutMs` are `60000`, `consolidationTimeoutMs` SHALL be
omitted (one-time legacy heal).

If the on-disk file exists but cannot be read, the route SHALL respond HTTP 500
with `{ error, code }` and SHALL NOT write. If it is readable but is not a JSON
plain object (no BOM stripping, as in upstream), its raw bytes SHALL be copied
(never renamed) to
`hermes-memory-config.json.corrupt-<stamp>` in the same directory before the
write. `<stamp>` is `YYYYMMDDTHHMMSSsssZ` (no `:`). The copy is created with
flag `wx` and mode `0600`, and a `-1`, `-2`, … suffix is appended on `EEXIST`.
The server SHALL log one line naming the quarantine path and the reason. If
that copy fails, the route SHALL respond HTTP 500 with `{ error, code }` and
SHALL NOT write.

The write SHALL be atomic (write a temporary file in the same directory, then
rename it into place).

#### Scenario: Successful save
- **WHEN** a valid config object is PUT and no file previously existed
- **THEN** the file is created at the resolved path containing every submitted field whose value differs from its default, plus `memoryOverflowStrategy`
- **AND** a subsequent GET reports `exists: true` with the saved values

#### Scenario: Atomic write leaves no partial file
- **WHEN** a save is performed
- **THEN** the final file appears via rename, never as a partially written file

#### Scenario: Unknown on-disk key survives a save
- **WHEN** the on-disk file contains `{ "futureHermesKey": 42 }` and a valid config object is PUT
- **THEN** the written file still contains `"futureHermesKey": 42`
- **AND** every submitted known field that differs from its default carries the submitted value

#### Scenario: Cleared known key is not resurrected from disk
- **WHEN** the on-disk file contains `{ "llmModelOverride": "a/b", "futureHermesKey": 42 }` and a valid config object without `llmModelOverride` is PUT
- **THEN** the written file has no `llmModelOverride` key
- **AND** still contains `"futureHermesKey": 42`

#### Scenario: Default-valued field is not pinned
- **WHEN** a valid config object with `nudgeInterval: 10` (its default) is PUT
- **THEN** the written file has no `nudgeInterval` key
- **AND** a subsequent GET reports `nudgeInterval` with `isDefault: true`

#### Scenario: Overflow strategy stays authoritative
- **WHEN** a valid config object with `memoryOverflowStrategy: "auto-consolidate"` (its default) and `autoConsolidate: false` is PUT
- **THEN** the written file contains `"memoryOverflowStrategy": "auto-consolidate"` and `"autoConsolidate": false`

#### Scenario: Legacy pinned consolidation timeout is healed once
- **WHEN** the on-disk file was written by the 0.8.1-era plugin (every 0.8.1 defaulted key present, `consolidationTimeoutMs: 60000`) and a config object with `consolidationTimeoutMs: 60000` is PUT
- **THEN** the written file has no `consolidationTimeoutMs` key
- **AND** a subsequent GET reports it as `180000` with `isDefault: true`

#### Scenario: Edited consolidation timeout is not healed
- **WHEN** the on-disk file is a 0.8.1-era write-all file with `consolidationTimeoutMs: 90000` and a config object with `consolidationTimeoutMs: 60000` is PUT
- **THEN** the written file contains `"consolidationTimeoutMs": 60000`

#### Scenario: Malformed on-disk file is backed up before overwrite
- **WHEN** the on-disk file contains `{"memoryMode":` (invalid JSON) and a valid config object is PUT
- **THEN** a `hermes-memory-config.json.corrupt-<stamp>` file holding the original bytes exists in the same directory, with no `:` in its name
- **AND** an existing quarantine file of the same name is not overwritten (a `-1` suffix is used)
- **AND** the config file contains the newly written object

#### Scenario: Unreadable on-disk file blocks the write
- **WHEN** the on-disk file exists but reading it fails with a non-`ENOENT` error
- **THEN** the response is HTTP 500
- **AND** the file on disk is unchanged

#### Scenario: On-disk __proto__ key is preserved as data
- **WHEN** the on-disk file contains `{ "__proto__": { "x": 1 } }` and a valid config object is PUT
- **THEN** the written file still contains the `"__proto__"` key with its value

## ADDED Requirements

### Requirement: Field set tracks the pinned pi-hermes-memory version
The plugin's re-declared `MemoryConfig` field set, enums and defaults SHALL
match `pi-hermes-memory@0.9.10` (`src/types.ts`, `src/config.ts`,
`src/constants.ts`). A test SHALL assert that `KNOWN_KEYS` and `DEFAULTS` equal
a checked-in upstream fixture for that version.

#### Scenario: Newer field is editable
- **WHEN** the settings form loads with no config file
- **THEN** `lazyInitialization`, `flushCompactTimeoutMs`, `quickCheckOnOpen`, `overflowGraceMs`, `consolidationChunking`, `consolidationChunkChars`, `usageHitTrackingEnabled`, `consolidationUsageSignals`, `autoConsolidationWarnOnFailure`, `standingInstructionsEnabled` and `sessionRetentionDays` each render with their 0.9.10 default and a DEFAULT badge
- **AND** `llmFallbackModels` renders empty with a DEFAULT badge (no built-in default)

#### Scenario: Max thinking level accepted
- **WHEN** `llmThinkingOverride` is `"max"` in a PUT body
- **THEN** validation passes and the value is written

#### Scenario: Updated default reported
- **WHEN** `consolidationTimeoutMs` is absent from the on-disk file
- **THEN** GET reports its default as `180000` with `isDefault: true`

#### Scenario: Drift guard catches an unsynced field
- **WHEN** the fixture field list and `KNOWN_KEYS` differ
- **THEN** the drift-guard test fails naming the differing keys

### Requirement: New-field bounds follow upstream with documented exceptions
Numeric bounds of the fields added in 0.9.x SHALL match upstream `loadConfig`,
except that `consolidationChunkChars` SHALL reject values below 500 and
`sessionRetentionDays` SHALL be a non-negative integer. Fields mirrored before
0.9.x keep their existing integer, non-negative descriptors.

#### Scenario: Negative flush timeout accepted as disable
- **WHEN** `flushCompactTimeoutMs` is `-1` in a PUT body
- **THEN** validation passes

#### Scenario: Chunk size below minimum rejected
- **WHEN** `consolidationChunkChars` is `499` in a PUT body
- **THEN** the response is HTTP 400 naming `consolidationChunkChars`
- **AND** the file on disk is unchanged

#### Scenario: Fractional retention rejected
- **WHEN** `sessionRetentionDays` is `0.5` in a PUT body
- **THEN** the response is HTTP 400 naming `sessionRetentionDays`
