# electron-settings-persistence Specification

## Purpose

Persist the Electron dashboard shell's chosen launch mode (standalone, power-user, or remote), the remote server URL, and a most-recently-used list of previously-connected remote dashboards to a single JSON settings file in the user's home directory. Persist the recommended-extensions wizard state to a separate file, and detect/write pi provider API keys under `~/.pi/agent`. Provide read-with-defaults, write, and a one-time migration from the legacy settings file name.

## Requirements

### Requirement: Settings storage and defaults

The system SHALL persist dashboard settings as JSON at `~/.pi-dashboard/dashboard-settings.json` and return a null/empty result when no settings have been written.

#### Scenario: No settings file exists

- **WHEN** the settings are read and neither the current nor a legacy settings file exists
- **THEN** the read returns null (no persisted mode)
- **AND** the recent-servers list is returned as empty

#### Scenario: First-run detection

- **WHEN** first-run status is checked and neither `dashboard-settings.json` nor a legacy `mode.json` exists in `~/.pi-dashboard`
- **THEN** the system reports that this is a first run

#### Scenario: Corrupt settings file

- **WHEN** the settings file exists but its contents are not valid JSON
- **THEN** the read returns null rather than raising an error

### Requirement: Mode persistence

The system SHALL persist the chosen mode with a completion timestamp, storing a remote URL only for remote mode, and SHALL treat a remote mode without a URL as unset.

#### Scenario: Persist a local mode

- **WHEN** a `standalone` or `power-user` mode is written
- **THEN** the settings file records that mode and an ISO-8601 completion timestamp
- **AND** no remote URL is stored

#### Scenario: Persist remote mode with URL

- **WHEN** `remote` mode is written together with a non-empty remote URL
- **THEN** the settings file records `remote` mode and the remote URL

#### Scenario: Read back a valid mode

- **WHEN** the persisted mode is read and it is `standalone`, `power-user`, or `remote` with a non-empty remote URL
- **THEN** the read returns the stored settings

#### Scenario: Remote mode missing its URL is invalid

- **WHEN** the persisted mode is `remote` but no remote URL is present
- **THEN** the read returns null (mode treated as unset)

#### Scenario: Writing a mode preserves recent servers

- **WHEN** a mode is written and a recent-servers list already exists
- **THEN** the existing recent-servers list is preserved in the updated settings

### Requirement: Recent remote servers MRU list

The system SHALL maintain a most-recently-used list of connected remote dashboards, ordered newest-first, de-duplicated by URL, and capped at 8 entries, without altering the persisted mode or remote URL.

#### Scenario: Record a newly connected server

- **WHEN** a successful connection to a remote URL is recorded and a settings file already exists
- **THEN** that URL is placed at the front of the recent-servers list with an ISO-8601 last-used timestamp
- **AND** the current mode and remote URL are preserved

#### Scenario: Record a server when no settings file exists

- **WHEN** a successful connection to a remote URL is recorded and no settings file exists (or it is corrupt)
- **THEN** a default settings object with `standalone` mode and a completion timestamp is seeded
- **AND** the URL is placed at the front of the recent-servers list

#### Scenario: Reconnecting to an existing server de-duplicates

- **WHEN** a URL already present in the list is recorded again
- **THEN** its prior entry is removed and it is re-added at the front with an updated timestamp

#### Scenario: List is capped at eight entries

- **WHEN** recording a server would grow the list beyond 8 entries
- **THEN** only the 8 most-recently-used entries are retained

#### Scenario: Remove a saved server

- **WHEN** a URL is removed from the recent-servers list
- **THEN** that URL no longer appears in the list
- **AND** the current mode and remote URL are preserved

#### Scenario: List order on read

- **WHEN** the recent-servers list is read
- **THEN** the entries are returned most-recently-used first

### Requirement: Legacy settings file migration

The system SHALL perform a one-time, best-effort migration of a legacy `~/.pi-dashboard/mode.json` file to `dashboard-settings.json` on read when the new file is absent.

#### Scenario: Migrate legacy file on first read

- **WHEN** settings are read, `dashboard-settings.json` does not exist, and a legacy `mode.json` does exist
- **THEN** the legacy contents are written to `dashboard-settings.json`
- **AND** the legacy `mode.json` is deleted
- **AND** the parsed legacy settings are returned

#### Scenario: Migration write failure still serves the value

- **WHEN** the legacy file is read but rewriting the new file or deleting the legacy file fails
- **THEN** the parsed legacy settings are still returned to the caller

### Requirement: Recommended-extensions wizard state

The system SHALL persist the recommended-extensions wizard state as JSON at `~/.pi-dashboard/recommended.json`, tracking the recommended-extension ids the user chose to skip and a completion timestamp, and SHALL return safe defaults when the file is absent or corrupt.

#### Scenario: Read defaults when no state file exists

- **WHEN** the recommended wizard state is read and `recommended.json` does not exist
- **THEN** the read returns an empty `skippedRecommended` list

#### Scenario: Read filters non-string skipped ids

- **WHEN** the recommended wizard state is read and the stored `skippedRecommended` contains non-string entries
- **THEN** only the string ids are returned
- **AND** the stored completion timestamp is returned when present

#### Scenario: Corrupt state file returns defaults

- **WHEN** the recommended state file exists but its contents are not valid JSON
- **THEN** the read returns an empty `skippedRecommended` list rather than raising an error

#### Scenario: Write replaces skipped ids and stamps completion

- **WHEN** the recommended wizard state is written
- **THEN** the stored `skippedRecommended` list is replaced (not merged) with the provided ids
- **AND** a completion timestamp is stored, defaulting to the current ISO-8601 time when not supplied

#### Scenario: Completion detection

- **WHEN** recommended-wizard completion is checked
- **THEN** the system reports completed if and only if `recommended.json` exists

### Requirement: API key detection and persistence

The system SHALL detect whether any pi provider credential is configured and SHALL write a provider API key into pi's settings file at `~/.pi/agent/settings.json`.

#### Scenario: Detect a configured provider credential

- **WHEN** API-key configuration is checked
- **THEN** detection is delegated to the shared provider-credential detector, which inspects both `~/.pi/agent/settings.json` and `~/.pi/agent/auth.json`
- **AND** the result is true when any provider credential is present

#### Scenario: Write a well-known provider key

- **WHEN** an API key is written for provider `anthropic` or `openai`
- **THEN** the key is stored under `anthropicApiKey` or `openaiApiKey` respectively in `~/.pi/agent/settings.json`
- **AND** any existing settings content is preserved

#### Scenario: Write a generic provider key

- **WHEN** an API key is written for any other provider name
- **THEN** the key is stored under `providers.<name>.apiKey` in `~/.pi/agent/settings.json`

#### Scenario: Corrupt or absent pi settings starts fresh

- **WHEN** an API key is written and `~/.pi/agent/settings.json` is absent or not valid JSON
- **THEN** the write starts from an empty settings object rather than raising an error

### Requirement: Write directory creation invariant

The system SHALL create the target directory recursively before writing any settings file.

#### Scenario: Managed directory is created before write

- **WHEN** any dashboard or recommended-wizard settings file is written and `~/.pi-dashboard` does not yet exist
- **THEN** the directory is created recursively before the file is written

#### Scenario: pi agent directory is created before API-key write

- **WHEN** an API key is written and `~/.pi/agent` does not yet exist
- **THEN** the directory is created recursively before the file is written
