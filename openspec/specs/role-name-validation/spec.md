# role-name-validation Specification

## Purpose

Define a single shared trust boundary that validates a custom role name before it is accepted. The same validator runs on the client (an inline ✓/✗ hint next to the add-role input) and on the bridge (a defense-in-depth reject before any write to the on-disk role config), so a name that passes in the UI is validated again by identical rules on the authoritative write path. Validation covers a syntax rule (allowed characters and starting character) and an optional collision rule against already-known role names, returning a boolean result plus a human-readable reason when it fails.

## Requirements

### Requirement: Syntactic validation of role names

The validator SHALL accept a role name only when, after trimming surrounding whitespace, it is non-empty and matches the pattern `^[A-Za-z0-9][A-Za-z0-9_-]*$` — it starts with a letter or digit and contains only letters, digits, hyphen (`-`), and underscore (`_`). Names containing `/`, whitespace, `@`, `.`, or any other character SHALL be rejected. The validator SHALL return a result object with `ok: true` on success, and `ok: false` with a `reason` string on failure.

#### Scenario: Valid custom role name

- **WHEN** a name of `"reviewer"` is validated with no colliding existing names
- **THEN** the result is `{ ok: true }`

#### Scenario: Valid name with hyphen, underscore, and digits

- **WHEN** a name such as `"code-review_2"` is validated with no colliding existing names
- **THEN** the result is `{ ok: true }`

#### Scenario: Empty or whitespace-only name is rejected

- **WHEN** a name of `""` or `"   "` is validated
- **THEN** the result is `ok: false`
- **AND** the reason is `"Name cannot be empty"`

#### Scenario: Reserved and disallowed characters are rejected

- **WHEN** a name containing `/`, `@`, `.`, a space, or any character outside `[A-Za-z0-9_-]` is validated (for example `"team/lead"`, `"@ref"`, or `"my role"`)
- **THEN** the result is `ok: false`
- **AND** the reason is `"Use letters, digits, - or _ only; must start with a letter or digit"`

#### Scenario: Name not starting with a letter or digit is rejected

- **WHEN** a name that begins with `-` or `_` such as `"-lead"` or `"_tmp"` is validated
- **THEN** the result is `ok: false`
- **AND** the reason is `"Use letters, digits, - or _ only; must start with a letter or digit"`

### Requirement: Collision check against existing role names

The validator SHALL reject a syntactically valid name when it is already present in the caller-supplied list of existing names. The comparison SHALL be case-sensitive to match the on-disk role-config keys. When the existing list is empty, the collision check SHALL be skipped, making the validation syntax-only.

#### Scenario: Collision with an existing name is rejected

- **WHEN** the name `"reviewer"` is validated against existing names that include `"reviewer"`
- **THEN** the result is `ok: false`
- **AND** the reason is `Role "reviewer" already exists`

#### Scenario: Case-sensitive collision

- **WHEN** the name `"Reviewer"` is validated against existing names that include `"reviewer"` but not `"Reviewer"`
- **THEN** the result is `{ ok: true }`

#### Scenario: Empty existing list skips the collision check

- **WHEN** any syntactically valid name is validated with an empty existing list
- **THEN** the collision check is skipped and the result is `{ ok: true }`

### Requirement: Identical enforcement on client hint and bridge write

The same validator SHALL run on the client add-role control and on the bridge write handlers, so the two paths cannot diverge. On the client, the name SHALL be validated against the union of built-in role names, persisted custom role names, and pending unsaved names, and the ✗ hint with the failure reason SHALL be shown and the confirm action blocked while the name is invalid. On the bridge, the name SHALL be re-validated syntactically (with an empty existing list, so only syntax is checked and re-assigning an existing role is allowed) before writing the role config; an invalid name SHALL cause the operation to fail without any disk write.

#### Scenario: Client blocks an invalid name and shows the reason

- **WHEN** the user types an invalid name into the add-role input
- **THEN** the confirm/add action is disabled
- **AND** an inline `✗` hint displays the validation reason

#### Scenario: Client blocks a name that collides with a known role

- **WHEN** the user types a name already present among built-in, persisted custom, or pending names
- **THEN** the add action is disabled with the "already exists" reason shown

#### Scenario: Bridge rejects an invalid role name on write

- **WHEN** a `roles:set` (or `roles:remove`) request arrives with a role name that fails syntactic validation
- **THEN** the request is marked unsuccessful
- **AND** no change is written to the role config on disk
