# session-display-name-resolution Specification

## Purpose

Resolve a human-readable display name for a dashboard session by walking an ordered fallback chain, so every session presents a non-empty label regardless of which metadata fields are populated.

## Requirements

### Requirement: Ordered display name fallback chain

The system SHALL resolve a session's display name by evaluating candidate sources in a fixed priority order and returning the first source that yields a usable value: explicit name, then first user message, then working-directory basename, then session id prefix.

#### Scenario: Explicit name present

- **WHEN** a session has a `name` whose trimmed value is non-empty
- **THEN** the system SHALL return the trimmed `name`
- **AND** SHALL NOT consider any lower-priority source

#### Scenario: Name absent, first message present

- **WHEN** a session's `name` is absent or trims to empty
- **AND** the session's `firstMessage` trims to a non-empty value
- **THEN** the system SHALL return the value derived from the trimmed `firstMessage`

#### Scenario: Name and first message absent

- **WHEN** both `name` and `firstMessage` are absent or trim to empty
- **THEN** the system SHALL derive the display name from the session's `cwd` or `id`

### Requirement: First message truncation

When resolving from the first user message, the system SHALL apply a fixed-length truncation rule to bound the returned label.

#### Scenario: Message longer than the limit

- **WHEN** the trimmed first message is longer than 50 characters
- **THEN** the system SHALL return the first 50 characters followed by an ellipsis `...`

#### Scenario: Message at or below the limit

- **WHEN** the trimmed first message is 50 characters or fewer
- **THEN** the system SHALL return the trimmed message unchanged

### Requirement: Working-directory and id fallback

When neither an explicit name nor a first message is available, the system SHALL prefer the final path segment of the working directory and fall back to a session id prefix only when that segment is empty.

#### Scenario: Working directory yields a basename

- **WHEN** the fallback reaches the working directory
- **AND** the final `/`-delimited segment of `cwd` is non-empty
- **THEN** the system SHALL return that final path segment

#### Scenario: Working directory has no usable basename

- **WHEN** the fallback reaches the working directory
- **AND** the final `/`-delimited segment of `cwd` is empty (e.g. `cwd` is empty or ends with `/`)
- **THEN** the system SHALL return the first 8 characters of the session `id`
