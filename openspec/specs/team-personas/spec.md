# team-personas Specification

## Purpose
TBD - created by archiving change add-team-plugin. Update Purpose after archive.

## Requirements

### Requirement: Persona schema and validation

The team plugin SHALL store personas as `schemaVersion: 1` JSON documents with the fields `key`, `scope`, `owner` (private only), `name` (1–60 Unicode code points), `description` (≤ 280 code points), `avatar`, `role` (`leader`|`member`), optional `model`, `instructions` (≤ 32768 UTF-8 bytes), `tools` (`chat`|`files`|`full`), `projects` (1–50 distinct targets: configured project ids or `_ws` for the own workspace; default `["_ws"]` when omitted on create), optional `skills`, optional `forkedFrom`, and the audit fields `createdAt`, `updatedAt`, `updatedBy`. A write with an unknown field, an out-of-range value, or a slug not matching `^[a-z0-9][a-z0-9-]{0,39}$` SHALL be rejected with `400 invalid_persona` and SHALL NOT change the store. A stored file with an unknown `schemaVersion` SHALL be skipped on read and logged, without failing the listing.

#### Scenario: Valid persona created
- **WHEN** an admin posts a shared persona `backend` with `tools:"files"`
- **THEN** `personas/backend.json` exists with `key:"shared:backend"` and `schemaVersion:1`

#### Scenario: Invalid slug refused
- **WHEN** a persona with slug `../etc` or `Backend` is posted
- **THEN** the response is `400 invalid_persona` and no file is written

#### Scenario: Future schema skipped
- **WHEN** `personas/x.json` has `schemaVersion: 2`
- **THEN** `GET /personas` lists the other personas and omits `x`

### Requirement: Project assignment

A persona's `projects` SHALL decide in which targets it appears and can start conversations. On a shared persona only an admin SHALL set it and MAY name any project (configured or folder-enabled); on a private persona the owner SHALL set it and MAY name only `_ws` and projects allowed for the owner. A write naming an unknown project id, or for a private persona a project not allowed for the owner, SHALL be rejected with `400 invalid_persona`. On read, ids of projects that are no longer configured or no longer allowed SHALL be ignored for visibility, without rewriting the file.

#### Scenario: Default is the own workspace
- **WHEN** alice creates a private persona without `projects`
- **THEN** it is stored with `projects: ["_ws"]`

#### Scenario: Private persona limited to allowed projects
- **WHEN** alice, who is not allowed on `crm`, saves a private persona with `projects: ["_ws", "crm"]`
- **THEN** the response is `400 invalid_persona` and nothing is written

#### Scenario: Admin assigns a template to projects
- **WHEN** an admin sets `shared:backend.projects` to `["billing", "crm"]`
- **THEN** every user allowed on `billing` sees `shared:backend` when `billing` is selected, and no user sees it in their own workspace

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

`POST /personas/:key/fork` SHALL copy a persona the caller can read into the caller's private scope, set `forkedFrom` to the source key, downgrade `tools:"full"` to `files`, and keep only the source's `projects` entries the caller may use (`_ws` and allowed projects), falling back to `["_ws"]` when none remain. The new slug SHALL be the optional body `slug` when given (an already used one SHALL answer `409 slug_taken`), else the source slug, suffixed `-2`, `-3`, and so on until free, with the base truncated so the result still matches the slug pattern. Later edits to the source SHALL NOT change the fork.

#### Scenario: Fork of a shared template
- **WHEN** alice forks `shared:backend`
- **THEN** a `private:<slug>` persona owned by alice exists with `forkedFrom:"shared:backend"`

#### Scenario: Fork keeps usable projects
- **WHEN** alice, allowed on `billing` only, forks a shared persona with `projects: ["billing", "crm"]`
- **THEN** the fork has `projects: ["billing"]`

#### Scenario: Fork drops bash
- **WHEN** alice forks a shared persona with `tools:"full"`
- **THEN** the fork has `tools:"files"`

### Requirement: Skills come from an admin catalog

A persona's `skills` SHALL be names of entries in the team skill catalog. A write naming an unknown skill SHALL be rejected with `400 invalid_persona`. Each listed skill SHALL be allowed, by its catalog entry's `targets`, for every target in the persona's `projects`. For a private persona each listed skill SHALL also be allowed, by its entry's `users`, for the owner. In single-user mode `users` is ignored. A write breaking either rule SHALL be rejected with `400 invalid_persona` and `fields.skills = "skill_not_allowed"`, and SHALL NOT change the store. Skill paths SHALL be resolved server-side from the catalog and SHALL never be taken from a persona.

#### Scenario: Unknown skill refused
- **WHEN** a persona lists skill `/tmp/evil` or a name not in the catalog
- **THEN** the response is `400 invalid_persona`

#### Scenario: Skill not allowed in an assigned target
- **WHEN** an admin saves `shared:backend` with `projects: ["billing", "crm"]` and `skills: ["review"]`, and `review` has `targets: ["billing"]`
- **THEN** the response is `400 invalid_persona` with `fields.skills = "skill_not_allowed"` and nothing is written

#### Scenario: Private persona skill not allowed for the owner
- **WHEN** alice saves a private persona with `skills: ["review"]`, and `review` lists only bob in `users` in multi-user mode
- **THEN** the response is `400 invalid_persona` and nothing is written

#### Scenario: Fork keeps only allowed skills
- **WHEN** alice forks a shared persona whose skills include one that is not allowed for her or for the fork's projects
- **THEN** the fork omits that skill

### Requirement: Persona deletion retires conversations

Deleting a persona SHALL remove its file and SHALL NOT delete any user's conversation record, own workspace or session file. In every target where a user has conversations with it, a deleted persona SHALL be listed with status `retired`, showing the name, avatar and role recorded when its most recent session started; its conversations SHALL NOT be started, and the user MAY archive or delete them.

#### Scenario: Retired card
- **WHEN** an admin deletes `shared:backend` that alice had used
- **THEN** alice's `GET /agents?project=billing` shows it as `retired`
- **AND** ensuring any of her conversations with it answers `404 persona_not_found`

### Requirement: Store integrity

Persona and conversation files SHALL be written atomically (temporary file then rename). Every store path SHALL be derived from validated slugs and the user key and SHALL resolve inside the team home directory; a path that resolves outside it SHALL be refused.

#### Scenario: Interrupted write leaves old content
- **WHEN** a write fails after the temporary file is created
- **THEN** the previous persona file content is unchanged
