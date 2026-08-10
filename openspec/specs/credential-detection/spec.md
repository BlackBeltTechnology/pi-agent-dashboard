# credential-detection Specification

## Purpose

Detect whether at least one LLM-provider credential is configured for pi, by inspecting two credential sources under `~/.pi/agent` and OR-merging the result into a single boolean. The detector supports environment probing (for example, Doctor diagnostics) that must answer "is any provider credential configured?" without ever throwing and without ever exposing the underlying secret values.

## Requirements

### Requirement: Merged credential presence detection

The system SHALL expose `hasAnyProviderCredential(homeDir)` that returns `true` when at least one provider credential is configured in either `~/.pi/agent/settings.json` or `~/.pi/agent/auth.json`, and `false` otherwise. The two sources SHALL be OR-merged: a credential in either source is sufficient. `homeDir` SHALL default to `os.homedir()` and MAY be overridden (for example, to a temp directory in tests).

A value SHALL count as a configured credential only when it is a non-empty string, defined as `typeof v === "string"` with `v.trim().length > 0`. Empty strings, whitespace-only strings, `null`, `undefined`, and non-string values SHALL NOT count as configured.

#### Scenario: No credential in either source

- WHEN both `settings.json` and `auth.json` exist but contain no non-empty credential field
- THEN `hasAnyProviderCredential` SHALL return `false`

#### Scenario: Credential present in settings only

- WHEN `settings.json` contains a non-empty `anthropicApiKey`
- AND `auth.json` contains no credential
- THEN `hasAnyProviderCredential` SHALL return `true`

#### Scenario: Credential present in auth only

- WHEN `settings.json` contains no credential
- AND `auth.json` contains an entry with a non-empty credential field
- THEN `hasAnyProviderCredential` SHALL return `true`

#### Scenario: Whitespace-only value is not a credential

- WHEN the only candidate field is an empty string or a whitespace-only string
- THEN that field SHALL NOT count as configured
- AND `hasAnyProviderCredential` SHALL return `false` if no other source has a credential

### Requirement: settings.json legacy API-key detection

The system SHALL treat `~/.pi/agent/settings.json` as configured when it is a JSON object containing any of the following non-empty string fields: top-level `anthropicApiKey`, top-level `openaiApiKey`, top-level `apiKey`, or a nested `providers[*].apiKey` where `providers` is an object whose values are objects each optionally carrying an `apiKey`. A `settings.json` that is missing, is not an object, or contains none of these non-empty fields SHALL NOT contribute a credential.

#### Scenario: Top-level legacy API key

- WHEN `settings.json` is `{ "anthropicApiKey": "<non-empty>" }` (or `openaiApiKey`, or `apiKey`)
- THEN the settings source SHALL be considered configured

#### Scenario: Nested provider API key

- WHEN `settings.json` contains `providers` as an object and at least one provider value is an object with a non-empty `apiKey`
- THEN the settings source SHALL be considered configured

#### Scenario: Non-object settings content

- WHEN `settings.json` parses to a non-object value (for example an array, number, or string)
- THEN the settings source SHALL NOT be considered configured

### Requirement: auth.json API-key and OAuth detection

The system SHALL treat `~/.pi/agent/auth.json` as configured when it is a JSON object whose values include at least one entry object carrying a non-empty `key`, `access`, or `refresh` field. This SHALL cover both coexisting entry shapes: the API-key shape `{ type, key }` and the OAuth shape `{ type, access, refresh, expires, ... }`. Entries that are not objects SHALL be skipped. An `auth.json` that is missing, is not an object, or contains no entry with a non-empty `key`/`access`/`refresh` SHALL NOT contribute a credential.

#### Scenario: OAuth-only credential

- WHEN `auth.json` contains an OAuth-shaped entry with a non-empty `access` or `refresh` field and no API keys exist anywhere
- THEN the auth source SHALL be considered configured
- AND `hasAnyProviderCredential` SHALL return `true`

#### Scenario: API-key entry

- WHEN `auth.json` contains an entry with a non-empty `key` field
- THEN the auth source SHALL be considered configured

#### Scenario: Non-object entries skipped

- WHEN an `auth.json` value is not an object (for example a string or number)
- THEN that entry SHALL be skipped without contributing a credential

### Requirement: Never-throw resilience

The detector SHALL NEVER throw. Reading each file SHALL be guarded so that a missing file, an unreadable file, or malformed JSON is treated as "no credential from that file" and SHALL fall through to the other source. A parse failure in one source SHALL NOT prevent detection of a credential in the other source.

#### Scenario: Missing files

- WHEN neither `settings.json` nor `auth.json` exists
- THEN `hasAnyProviderCredential` SHALL return `false` without throwing

#### Scenario: Corrupt JSON in one source

- WHEN `settings.json` contains malformed JSON
- AND `auth.json` contains a valid entry with a non-empty credential field
- THEN the corrupt source SHALL be treated as having no credential
- AND `hasAnyProviderCredential` SHALL return `true` from the valid source

#### Scenario: Corrupt JSON in both sources

- WHEN both `settings.json` and `auth.json` contain malformed JSON
- THEN `hasAnyProviderCredential` SHALL return `false` without throwing

### Requirement: Never-leak guarantee and inspected-path disclosure

The detector SHALL NEVER return, log, or hash credential values; it SHALL return only the boolean result. The system SHALL additionally expose `inspectedCredentialFiles(homeDir)` returning the two absolute paths it inspects — `[<homeDir>/.pi/agent/settings.json, <homeDir>/.pi/agent/auth.json]` — in inspection order, so callers (for example Doctor's detail output) can name the files without duplicating path logic or exposing secrets.

#### Scenario: Boolean-only result

- WHEN a credential is present in either source
- THEN the detector SHALL return `true` as a plain boolean
- AND SHALL NOT expose the credential's string value through its return, logs, or hashes

#### Scenario: Inspected paths reported in order

- WHEN `inspectedCredentialFiles(homeDir)` is called
- THEN it SHALL return exactly two absolute paths
- AND the first SHALL be `<homeDir>/.pi/agent/settings.json`
- AND the second SHALL be `<homeDir>/.pi/agent/auth.json`
