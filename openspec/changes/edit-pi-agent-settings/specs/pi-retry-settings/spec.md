## MODIFIED Requirements

### Requirement: Saving writes a merge-preserving global settings block

Saving SHALL write into the GLOBAL `~/.pi/agent/settings.json`. The write SHALL preserve the value of
every unrelated key, including keys the dashboard does not know about; whitespace, key order, and a
leading byte-order mark are not preserved (the file is re-serialised as 2-space-indented JSON). The
project-scoped `.pi/settings.json` SHALL NEVER be written. When the existing file cannot be parsed as
JSON, the save SHALL be rejected and the file SHALL be left byte-identical — a retry policy SHALL NEVER
be written over an empty object in place of unreadable content.

#### Scenario: Unrelated keys survive the write byte-identically

- **GIVEN** `~/.pi/agent/settings.json` contains `packages`, `extensions`, and
  `dashboardPluginBridges` keys
- **WHEN** the user saves a retry policy
- **THEN** the file SHALL contain the new `retry` block
- **AND** `packages`, `extensions`, and `dashboardPluginBridges` SHALL be deep-equal to their
  prior values

#### Scenario: Unknown keys inside the retry block survive

- **GIVEN** the file contains `retry.someFutureKnob`
- **WHEN** the user saves the six known fields
- **THEN** `retry.someFutureKnob` SHALL remain unchanged

#### Scenario: Project settings are never written

- **WHEN** any retry policy is saved
- **THEN** `<cwd>/.pi/settings.json` SHALL NOT be created or modified

#### Scenario: Unparseable settings file is not overwritten

- **GIVEN** `~/.pi/agent/settings.json` contains truncated JSON
- **WHEN** the user saves a retry policy
- **THEN** the save SHALL be rejected with a parse error
- **AND** the file SHALL be byte-identical to before
- **AND** no session SHALL be reloaded

## ADDED Requirements

### Requirement: Retry saves coordinate with pi's settings lock

A retry save SHALL take the same advisory file lock pi takes when it writes `~/.pi/agent/settings.json`,
SHALL re-read the file while holding it, and SHALL replace the file atomically. When the lock cannot be
acquired within pi's own retry budget the save SHALL be rejected with `503`, nothing SHALL be written,
and no session SHALL be reloaded. The editor SHALL treat `503` like any failed commit: the source stays
dirty and the failure is shown.

#### Scenario: Held lock rejects the save

- **GIVEN** the pi settings lock is held by another process for longer than the retry budget
- **WHEN** the user saves a retry policy
- **THEN** the response SHALL be `503`
- **AND** the file SHALL be byte-identical to before
- **AND** no session SHALL be reloaded
- **AND** the Retry section SHALL remain dirty
