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
(true when the key is absent from the on-disk file).

#### Scenario: File present with one overridden field
- **WHEN** the file contains `{ "llmModelOverride": "anthropic/claude-haiku-4-5" }`
- **THEN** `fields.llmModelOverride` is `{ value: "anthropic/claude-haiku-4-5", default: <unset-default>, isDefault: false }`
- **AND** every other field reports its default with `isDefault: true`
- **AND** `exists` is `true`

#### Scenario: File absent
- **WHEN** no config file exists at the resolved path
- **THEN** the response has `exists: false`
- **AND** every field reports its default with `isDefault: true`

### Requirement: Write the full resolved config
`PUT /api/plugins/hermes-memory/config` SHALL accept a complete config object,
validate it, and on success write every field's effective value to the file as
pretty-printed (2-space) JSON, creating the parent directory if missing. The
write SHALL be atomic (write a temporary file in the same directory, then
rename it into place).

#### Scenario: Successful save
- **WHEN** a valid config object is PUT and no file previously existed
- **THEN** the file is created at the resolved path containing all fields
- **AND** a subsequent GET reports `exists: true` with the saved values

#### Scenario: Atomic write leaves no partial file
- **WHEN** a save is performed
- **THEN** the final file appears via rename, never as a partially written file

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

