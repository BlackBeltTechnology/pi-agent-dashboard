# scoped-markdown-editing Specification

## Purpose
Defines the editable markdown surface (Instructions page) for directory and global scope: a Monaco buffer + scope-bounded file picker, persisted via `POST /api/file/write` with mtime conflict detection, gated by a scope-aware `isWritableMdTarget` write allowlist (cwd tree for directory scope, `~/.pi/agent` for global).
## Requirements
### Requirement: Instructions page SHALL edit markdown in directory and global scope

An `Instructions` page SHALL be mounted in the directory settings page (directory scope) and in the global settings page under Advanced (global scope). The page SHALL present a scope-bounded file picker and an editable markdown surface backed by a Monaco buffer. Editing SHALL persist through `POST /api/file/write`.

Directory scope SHALL offer markdown files under the folder cwd and its `.pi/` tree. Global scope SHALL offer markdown files under `~/.pi/agent`.

#### Scenario: Edit and save a project instruction file
- **GIVEN** the Instructions page is open in directory settings for cwd `/Users/u/proj`
- **AND** the user picks `AGENTS.md` from the scoped picker
- **WHEN** the user edits the buffer and clicks Save
- **THEN** the dashboard issues `POST /api/file/write` for `/Users/u/proj/AGENTS.md`
- **AND** on success the dirty state clears

#### Scenario: Edit a global pi instruction file
- **GIVEN** the Instructions page is open in global settings → Advanced
- **AND** the user picks a markdown file under `~/.pi/agent`
- **WHEN** the user edits and saves
- **THEN** the write targets the file under `~/.pi/agent` and succeeds

### Requirement: Save SHALL be dirty-gated with an unsaved-changes guard

The Instructions page SHALL expose a Save Bar enabled only when the buffer is dirty, with Save and Discard actions. Navigating away while dirty SHALL prompt an unsaved-changes confirmation (mirroring the global settings save contract).

#### Scenario: Save Bar gating
- **GIVEN** a freshly loaded, unmodified markdown buffer
- **THEN** the Save and Discard actions are disabled
- **WHEN** the user types a change
- **THEN** Save and Discard become enabled

#### Scenario: Unsaved-changes guard blocks navigation
- **GIVEN** the buffer is dirty
- **WHEN** the user attempts to navigate away
- **THEN** an unsaved-changes confirmation is shown before the navigation proceeds

### Requirement: Concurrent-edit conflicts SHALL be detected by mtime

`POST /api/file/write` SHALL carry the mtime the buffer was loaded at. When the on-disk mtime differs, the server SHALL respond `409 Conflict` and the write SHALL NOT clobber the file. The page SHALL surface the conflict to the user.

#### Scenario: External change produces a 409
- **GIVEN** a markdown buffer loaded at mtime T
- **AND** the file is modified on disk after T
- **WHEN** the user saves
- **THEN** the server responds `409 Conflict`
- **AND** the on-disk file is unchanged
- **AND** the user is shown a conflict notice

### Requirement: Write target authorization SHALL be allowlist-bounded

The server SHALL gate every markdown write through an `isWritableMdTarget(absPath, { cwd? })` check (realpath-normalized; resolves symlinks via async filesystem I/O). With a `cwd`, allowed targets SHALL be `<cwd>/**/*.md` and `<cwd>/.pi/**`. Without a `cwd` (global scope), allowed targets SHALL be limited to `~/.pi/agent/**/*.md`. Paths SHALL be realpath-normalized before the check; symlink or `..` escape and non-markdown targets SHALL be rejected with `403`.

The file picker SHALL only offer candidates that satisfy the same allowlist, so the UI can never present a target the guard rejects.

#### Scenario: Out-of-scope path is rejected
- **GIVEN** a write request for `/etc/passwd`
- **WHEN** the server evaluates `isWritableMdTarget`
- **THEN** the check fails
- **AND** the server responds `403`
- **AND** no write occurs

#### Scenario: Symlink escape is rejected
- **GIVEN** `<cwd>/notes.md` is a symlink resolving to `~/.ssh/config`
- **WHEN** the user attempts to save it
- **THEN** realpath normalization resolves the target outside the allowlist
- **AND** the server responds `403`

#### Scenario: Global scope rejects paths outside the pi dir
- **GIVEN** a global-scope write request for `~/Documents/secret.md`
- **WHEN** the server evaluates `isWritableMdTarget` with no `cwd`
- **THEN** the check fails because the target is not under `~/.pi/agent`
- **AND** the server responds `403`

