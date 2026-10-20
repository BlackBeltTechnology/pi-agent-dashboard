# hermes-memory-settings Specification

## Purpose
TBD - created by archiving change add-hermes-memory-settings-plugin. Update Purpose after archive.

## Requirements

### Requirement: Resolve the hermes config file path like the extension
The plugin server SHALL resolve the config file path identically to the
`pi-hermes-memory` extension: use `PI_CODING_AGENT_DIR` (trimmed, with a leading
`~` expanded to the home directory) when set, otherwise `<home>/.pi/agent`, then
join the fixed filename `hermes-memory-config.json`. The filename SHALL NOT be
taken from request input.

#### Scenario: Default agent root
- **WHEN** `PI_CODING_AGENT_DIR` is unset
- **THEN** the resolved path is `<home>/.pi/agent/hermes-memory-config.json`

#### Scenario: Overridden agent root
- **WHEN** `PI_CODING_AGENT_DIR` is set to `/tmp/agent`
- **THEN** the resolved path is `/tmp/agent/hermes-memory-config.json`

### Requirement: Read effective config with per-field defaults
`GET /api/plugins/hermes-memory/config` SHALL return the resolved file path, a
file-level `exists` flag, a `raw` resolved config object, and a `fields` map
where each known `MemoryConfig` key carries `value` (the on-disk value when
present, else the default), `default` (the built-in default), and `isDefault`
(true when the key is absent from the on-disk file). `raw` SHALL also contain
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
- **WHEN** the on-disk file contains `{ "memoryMode": ` (invalid JSON) and a valid config object is PUT
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

### Requirement: Reject invalid config before writing
The PUT route SHALL validate the submitted object against the known
`MemoryConfig` field set and reject it with HTTP 400 and a field-scoped message
WITHOUT writing the file when: an unknown key is present, a value has the wrong
type, an enum value is out of range, a numeric bound is violated, or any entry
of a `correction*Patterns` array is not a compilable regular expression.

#### Scenario: Unknown key
- **WHEN** the body includes a key not in the `MemoryConfig` field set
- **THEN** the response is HTTP 400 naming the unknown key
- **AND** the file on disk is unchanged

#### Scenario: Out-of-range enum
- **WHEN** `memoryMode` is `"bogus"`
- **THEN** the response is HTTP 400 naming `memoryMode`
- **AND** the file on disk is unchanged

#### Scenario: Uncompilable correction regex
- **WHEN** `correctionStrongPatterns` contains an entry that throws in `new RegExp(...)`
- **THEN** the response is HTTP 400 naming the offending pattern
- **AND** the file on disk is unchanged

### Requirement: Activate only when the extension is installed
The plugin SHALL declare `requires.piExtensions: ["pi-hermes-memory"]` so its
settings surface and routes are active only when the `pi-hermes-memory`
extension is present.

#### Scenario: Extension absent
- **WHEN** `pi-hermes-memory` is not installed
- **THEN** the hermes-memory settings section is not shown

### Requirement: Settings form shows current value or default
The settings section SHALL render every `MemoryConfig` field grouped by concern,
displaying each field's effective value; when a field is unset on disk the form
SHALL display the resolved default value and mark the field as a default (a
DEFAULT badge). Each field SHALL provide a per-field reset that returns it to its
default, and the surface SHALL provide a read-only raw-JSON view of the resolved
config and a notice that changes apply to newly started sessions.

#### Scenario: Unset field shows default with badge
- **WHEN** `nudgeInterval` is absent from the file (default 10)
- **THEN** the field displays `10` and shows a DEFAULT badge

#### Scenario: Reset a changed field
- **WHEN** the user edits a field then clicks its reset control
- **THEN** the field returns to its default value and is marked as a default again

#### Scenario: Save persists via the write route
- **WHEN** the user changes a field and saves
- **THEN** the client PUTs the full resolved config to the write route
- **AND** the saved value is reflected on reload

### Requirement: Model override uses the shared model selector
The `llmModelOverride` field SHALL be edited with the dashboard's shared model selector populated from the dashboard's model list, plus an explicit "inherit session model" action that clears the value. The stored value SHALL remain a `provider/id` string. A stored value that is not in the current model list SHALL still be displayed (not silently dropped) and SHALL be preserved on save unless the user changes it.

#### Scenario: Pick a model
- **WHEN** the user opens the Model override selector and chooses `anthropic/claude-sonnet-4`
- **THEN** saving writes `"llmModelOverride": "anthropic/claude-sonnet-4"`

#### Scenario: Clear to inherit
- **WHEN** the user activates "inherit session model"
- **THEN** the field shows the DEFAULT badge
- **AND** saving leaves `llmModelOverride` absent from the file, the same as the existing per-field reset, so after reload it is still reported as default and sessions inherit their own model

#### Scenario: Unknown stored model preserved
- **WHEN** the file holds `"llmModelOverride": "openrouter/deepseek/deepseek-v4-flash"` and that model is not in the model list
- **THEN** the selector shows that value and saving without edits keeps it unchanged

### Requirement: Hermes settings fields are labelled, described and announce errors
Every hermes-memory settings field SHALL render through the shared settings field components (`settings-panel`), so each control has an associated `<label>` and its help text is linked by `aria-describedby`; the Model override field uses `FieldShell` with the model selector as its custom control, still looked up with the strict `useUiPrimitive("ui:model-selector")` (a shell-bound wrapper, not a transient picker). A field validation error SHALL set `aria-invalid="true"` on the control and SHALL be linked by `aria-describedby`; validation messages from `settings-model.ts` SHALL be translated through `t()` with `en`, `hu` and `zh-CN` entries. Boolean fields SHALL use `ToggleField` (`role="switch"`). The section SHALL NOT paint any text with an `--accent-*` token (today: load error, file path, status line, save error, reset and inherit links, field error).

#### Scenario: Every control has an accessible name
- **WHEN** an accessibility snapshot of the populated section is taken
- **THEN** every input, select, textarea and switch has a non-empty accessible name equal to its field label

#### Scenario: Invalid number is announced
- **WHEN** the user types `abc` into `memoryCharLimit`
- **THEN** the input has `aria-invalid="true"` and its `aria-describedby` includes the error text element

### Requirement: Hermes raw-JSON view and missing models follow the contract
The raw-JSON view SHALL be a dialog with `role="dialog"`, `aria-modal="true"`, a labelled title, a focus trap, Escape-to-close that returns focus to the "View raw JSON" control, and an `--bg-overlay` scrim, with no `bg-black/*` or other palette class. When the model list is empty, the Model override field SHALL show an info notice with an action that opens the Providers settings. The DEFAULT badge, per-field reset, "inherit session model" action and unknown-model preservation required by the existing hermes requirements SHALL be kept, rendered through `FieldShell`'s `state` and `onReset` and the field's own controls. The section SHALL pass the contrast, size and focus probes in every listed theme and width in these states: loading, load error, populated, invalid with unsaved changes, models unavailable, and raw-JSON dialog open. Every existing `hermes-*` test id SHALL still render in its state.

#### Scenario: Dialog traps focus and closes on Escape
- **WHEN** the raw-JSON dialog is open and the user presses Tab repeatedly, then Escape
- **THEN** focus stays inside the dialog while open, and after Escape the dialog is closed and "View raw JSON" has focus

#### Scenario: No models offers a way forward
- **WHEN** `GET /api/models` returns an empty list
- **THEN** the Model override field shows a notice with an "Open Providers" action

#### Scenario: Probes pass in every state
- **WHEN** the capture spec probes each listed state in every listed theme and width
- **THEN** every contrast, size and focus failure list is empty

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
