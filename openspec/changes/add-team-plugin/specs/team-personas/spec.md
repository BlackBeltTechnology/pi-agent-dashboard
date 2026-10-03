## ADDED Requirements

### Requirement: Persona schema and validation

The team plugin SHALL store personas as `schemaVersion: 1` JSON documents with the fields `key`, `scope`, `owner` (private only), `name` (1–60 Unicode code points), `description` (≤ 280 code points), `avatar`, `role` (`leader`|`member`), optional `model`, `instructions` (≤ 32768 UTF-8 bytes), `tools` (`chat`|`files`|`full`), optional `skills`, optional `forkedFrom`, and the audit fields `createdAt`, `updatedAt`, `updatedBy`. A write with an unknown field, an out-of-range value, or a slug not matching `^[a-z0-9][a-z0-9-]{0,39}$` SHALL be rejected with `400 invalid_persona` and SHALL NOT change the store. A stored file with an unknown `schemaVersion` SHALL be skipped on read and logged, without failing the listing.

#### Scenario: Valid persona created
- **WHEN** an admin posts a shared persona `backend` with `tools:"files"`
- **THEN** `personas/backend.json` exists with `key:"shared:backend"` and `schemaVersion:1`

#### Scenario: Invalid slug refused
- **WHEN** a persona with slug `../etc` or `Backend` is posted
- **THEN** the response is `400 invalid_persona` and no file is written

#### Scenario: Future schema skipped
- **WHEN** `personas/x.json` has `schemaVersion: 2`
- **THEN** `GET /personas` lists the other personas and omits `x`

### Requirement: Persona count limits

A user SHALL own at most 50 private personas and the store SHALL hold at most 200 shared personas. A create that would exceed a limit SHALL be rejected with `409 persona_limit` and SHALL NOT write a file. Forks count against the private limit.

#### Scenario: Fifty-first private persona refused
- **WHEN** alice owns 50 private personas and creates or forks another
- **THEN** the response is `409 persona_limit` and she still owns 50

### Requirement: Shared and private scopes

Shared personas SHALL be visible to every principal. Private personas SHALL be visible and writable only by their owner. A request for another user's private persona SHALL answer `404 persona_not_found`, indistinguishable from a missing persona. `tools:"full"` SHALL be accepted only on shared personas and only in single-user mode; in multi-user mode a write with `tools:"full"` SHALL be rejected with `400 invalid_persona` and a stored `full` persona SHALL be listed as unavailable and never started.

#### Scenario: Private persona hidden from others
- **WHEN** alice owns `private:copywriter` and bob calls `GET /personas`
- **THEN** bob's listing does not contain it
- **AND** bob's `PUT /personas/private:copywriter` answers `404 persona_not_found`

#### Scenario: No bash in multi-user mode
- **WHEN** identity is active and an admin posts a shared persona with `tools:"full"`
- **THEN** the response is `400 invalid_persona`

#### Scenario: Private persona cannot run bash
- **WHEN** alice posts a private persona with `tools:"full"`
- **THEN** the response is `400 invalid_persona`

### Requirement: Admin gate for shared personas

Creating, updating or deleting a shared persona SHALL require an admin: a principal listed in the plugin config `admins` when identity is active, or the local operator in single-user mode (identity inactive). Any other principal SHALL receive `403 admin_required`. `GET /me` SHALL report the caller's `admin` flag.

#### Scenario: Non-admin refused
- **WHEN** bob (not in `admins`) posts a shared persona
- **THEN** the response is `403 admin_required` and nothing is written

#### Scenario: Local operator is admin
- **WHEN** identity is inactive and the local operator calls `GET /me`
- **THEN** `admin` is `true`

### Requirement: Fork a persona into the private scope

`POST /personas/:key/fork` SHALL copy a persona the caller can read into the caller's private scope, set `forkedFrom` to the source key, and downgrade `tools:"full"` to `files`. The new slug SHALL be the optional body `slug` when given (an already used one SHALL answer `409 slug_taken`), else the source slug, suffixed `-2`, `-3`, and so on until free, with the base truncated so the result still matches the slug pattern. Later edits to the source SHALL NOT change the fork.

#### Scenario: Fork of a shared template
- **WHEN** alice forks `shared:backend`
- **THEN** a `private:<slug>` persona owned by alice exists with `forkedFrom:"shared:backend"`

#### Scenario: Fork drops bash
- **WHEN** alice forks a shared persona with `tools:"full"`
- **THEN** the fork has `tools:"files"`

### Requirement: Skills come from an admin catalog

A persona's `skills` SHALL be names defined in the plugin config `skillCatalog`; a write naming an unknown skill SHALL be rejected with `400 invalid_persona`. Skill paths SHALL be resolved server-side from the catalog and SHALL never be taken from a persona.

#### Scenario: Unknown skill refused
- **WHEN** a persona lists skill `/tmp/evil` or a name not in `skillCatalog`
- **THEN** the response is `400 invalid_persona`

### Requirement: Persona deletion retires instances

Deleting a persona SHALL remove its file and SHALL NOT delete any user's instance record, workspace or session file. Instances of a deleted persona SHALL be listed with status `retired`, showing the name, avatar and role recorded when the session last started, and SHALL NOT be started.

#### Scenario: Retired card
- **WHEN** an admin deletes `shared:backend` that alice had used
- **THEN** alice's `GET /agents` shows it as `retired`
- **AND** `POST /agents/shared:backend/session` answers `404 persona_not_found`

### Requirement: Store integrity

Persona and instance files SHALL be written atomically (temporary file then rename). Every store path SHALL be derived from validated slugs and the user key and SHALL resolve inside the team home directory; a path that resolves outside it SHALL be refused.

#### Scenario: Interrupted write leaves old content
- **WHEN** a write fails after the temporary file is created
- **THEN** the previous persona file content is unchanged
