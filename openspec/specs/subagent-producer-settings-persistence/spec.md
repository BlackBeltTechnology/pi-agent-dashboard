# subagent-producer-settings-persistence Specification

## Purpose
The subagents plugin server persists the `inheritContext` toggle to the producer extension's settings file at `~/.pi/agent/extensions/pi-dashboard-subagents/config.json`. Reads and writes tolerate a missing or corrupt file, and merges preserve every key the plugin does not expose so hand-edited producer configuration survives a dashboard write.

## Requirements

### Requirement: Producer settings file location
The plugin SHALL resolve the producer settings file to `config.json` inside the `pi-dashboard-subagents` extension directory under the current user's home directory.

#### Scenario: Resolving the settings path
- **WHEN** the plugin resolves the producer settings file path
- **THEN** the path is `<home>/.pi/agent/extensions/pi-dashboard-subagents/config.json`
- **AND** the path is derived from the current user's home directory

### Requirement: Fault-tolerant read with defaults
The plugin SHALL read the producer settings file and return an empty settings object when the file is absent, unparseable, or does not contain a JSON object, and reading SHALL never throw.

#### Scenario: File is missing
- **WHEN** the settings file does not exist
- **THEN** the read returns an empty object `{}`

#### Scenario: File contains malformed JSON
- **WHEN** the settings file exists but its contents are not valid JSON
- **THEN** the read returns an empty object `{}`
- **AND** a warning is logged
- **AND** no error is thrown

#### Scenario: File contains a non-object JSON value
- **WHEN** the settings file parses to a JSON value that is not an object (e.g. a string, number, or null)
- **THEN** the read returns an empty object `{}`

#### Scenario: File is well-formed
- **WHEN** the settings file contains a valid JSON object
- **THEN** the read returns that object with all of its keys intact

### Requirement: Atomic fault-tolerant write
The plugin SHALL write producer settings atomically, creating the parent directory when it is missing, and writing SHALL never throw and SHALL leave no partial or temporary file behind on success.

#### Scenario: Writing settings
- **WHEN** the plugin writes a settings object
- **THEN** the file at the resolved path contains that object serialized as formatted JSON
- **AND** no leftover temporary file remains in the directory

#### Scenario: Parent directory does not exist
- **WHEN** the plugin writes settings and the parent directory chain does not yet exist
- **THEN** the missing directories are created
- **AND** the settings file is written

#### Scenario: Write fails
- **WHEN** the underlying write operation fails
- **THEN** a warning is logged
- **AND** no error is thrown

### Requirement: Merge preserves unexposed keys
When merging a plugin patch into existing producer settings, the plugin SHALL update only the `inheritContext` key and SHALL preserve every other key verbatim, including `exposeInheritanceInTool`, `inheritance`, and any user-added keys.

#### Scenario: Patch updates inheritContext
- **WHEN** existing settings hold `inheritContext`, `exposeInheritanceInTool`, `inheritance`, and a user-added key, and a patch sets `inheritContext` to a new value
- **THEN** the merged settings use the patch's `inheritContext`
- **AND** `exposeInheritanceInTool`, `inheritance`, and the user-added key are unchanged

#### Scenario: Patch omits inheritContext
- **WHEN** a patch does not include `inheritContext`
- **THEN** the merged settings leave the existing `inheritContext` and all other keys unchanged

### Requirement: Startup reconcile from producer file
On plugin startup the plugin SHALL treat the producer settings file as the source of truth for `inheritContext`, and when the file defines a boolean `inheritContext` the plugin SHALL push that value into the dashboard plugin configuration.

#### Scenario: Producer file defines inheritContext
- **WHEN** the plugin starts and the producer settings file contains a boolean `inheritContext`
- **THEN** the dashboard plugin configuration is updated to that `inheritContext` value

#### Scenario: Producer file omits or has non-boolean inheritContext
- **WHEN** the plugin starts and the producer settings file has no `inheritContext` or a non-boolean value
- **THEN** the dashboard plugin configuration is left unchanged

### Requirement: Write-through mirror on config change
After the dashboard plugin configuration is successfully persisted, the plugin SHALL mirror the current `inheritContext` into the producer settings file by merging it with the existing file contents and writing atomically, preserving unexposed keys.

#### Scenario: Plugin config POST succeeds
- **WHEN** a `POST /api/config/plugins/subagents` request completes with status 200
- **THEN** the current plugin `inheritContext` is merged into the existing producer settings
- **AND** the merged settings are written to the producer settings file
- **AND** all unexposed keys in the existing file are preserved

#### Scenario: Non-matching or failed request
- **WHEN** the request is not a successful `POST` to `/api/config/plugins/subagents`
- **THEN** the producer settings file is not modified
