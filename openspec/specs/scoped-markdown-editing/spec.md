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

`POST /api/file/write` SHALL carry the mtime the buffer was loaded at. The mtime token SHALL be full precision (`stat.mtimeMs`) on every read endpoint that feeds a save and on the write-side comparison; a rounded token SHALL NOT be used. When the on-disk mtime differs, the server SHALL respond `409 Conflict` and the write SHALL NOT clobber the file. The page SHALL surface the conflict to the user.

#### Scenario: External change produces a 409
- **GIVEN** a markdown buffer loaded at mtime T
- **AND** the file is modified on disk after T
- **WHEN** the user saves
- **THEN** the server responds `409 Conflict`
- **AND** the on-disk file is unchanged
- **AND** the user is shown a conflict notice

### Requirement: Write target authorization SHALL be allowlist-bounded

The server SHALL gate every text-document write through an `isWritableMdTarget(absPath, { cwd? })` check (realpath-normalized; resolves symlinks via async filesystem I/O). Writable extensions SHALL be the `editable` text kinds `.md`, `.mdx`, `.adoc`, `.asciidoc`, `.csv` plus, in directory scope only, the Mermaid source files `.mmd`, `.mermaid`, checked on the realpath target. With a `cwd`, allowed targets SHALL be files of those extensions under `<cwd>/**` (including `<cwd>/.pi/**`). A target outside `<cwd>` SHALL be refused unless a write-mode path grant admits it (see "An out-of-cwd write SHALL be gated by a write-mode path grant"). Without a `cwd` (global scope), allowed targets SHALL be limited to `~/.pi/agent/**/*.md`. Paths SHALL be realpath-normalized before the check; symlink or `..` escape without such a write-mode grant, and targets of any other extension, SHALL be rejected with `403`.

The file picker SHALL only offer candidates that satisfy the same allowlist, so the UI can never present a target the guard rejects.

#### Scenario: Out-of-scope path is rejected
- **GIVEN** a write request for `/etc/passwd` (not a text-doc extension, so it never reaches the grant gate)
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

#### Scenario: In-scope editable text docs are writable
- **GIVEN** `<cwd>/guide.adoc`, `<cwd>/guide.asciidoc` and `<cwd>/data.csv` exist
- **WHEN** the server evaluates `isWritableMdTarget` with that `cwd`
- **THEN** the check passes for each

#### Scenario: In-scope Mermaid sources are writable
- **GIVEN** `<cwd>/flow.mmd` and `<cwd>/flow.mermaid` exist
- **WHEN** the server evaluates `isWritableMdTarget` with that `cwd`
- **THEN** the check passes for each

#### Scenario: Global scope rejects Mermaid sources
- **GIVEN** a global-scope write request for `~/.pi/agent/flow.mmd`
- **WHEN** the server evaluates `isWritableMdTarget` with no `cwd`
- **THEN** the check fails
- **AND** the server responds `403`

#### Scenario: Symlinked Mermaid source escaping the cwd is rejected
- **GIVEN** `<cwd>/flow.mmd` is a symlink resolving to a `.mmd` file outside `<cwd>` (Mermaid sources never reach the grant gate)
- **WHEN** the server evaluates `isWritableMdTarget` with that `cwd`
- **THEN** the check fails
- **AND** the server responds `403`

#### Scenario: AsciiDoc traversal escape is rejected
- **GIVEN** a write request for `<cwd>/../sibling/evil.adoc` and no write-mode grant covering `sibling`
- **WHEN** the server evaluates `isWritableMdTarget`
- **THEN** the check fails and the request is handled by the grant gate: it suspends for the operator prompt for a prompt-eligible caller
- **AND** the server responds `403` and writes nothing when the prompt is denied or expires, or the caller is not prompt-eligible

#### Scenario: Out-of-cwd text doc is not rejected outright
- **GIVEN** a write request for `/Users/u/Downloads/x.md` with a `cwd` and a covering write-mode grant
- **WHEN** the server evaluates the write
- **THEN** `isWritableMdTarget` fails but the write-mode grant gate admits it and the write proceeds

### Requirement: An out-of-cwd write SHALL be gated by a write-mode path grant

In directory scope, an allowlisted non-Mermaid text-doc write whose realpath is outside `<cwd>` and not dashboard state SHALL be admitted only by a `mode: "write"` grant or an allowed write prompt (`action: "write"`); the check anchors at `<cwd>` only, skips bound-checkout widening and ignores read grants. An un-granted miss SHALL suspend for the prompt; denial, expiry, an ineligible caller or a changed realpath SHALL write nothing (`403` with the remedy). Global scope is unchanged.

#### Scenario: Un-granted write raises the write prompt
- **GIVEN** `/Users/u/Downloads/x.md` outside the cwd and no write-mode grant
- **WHEN** a prompt-eligible caller POSTs `/api/file/write`
- **THEN** the request SHALL suspend for the write prompt, and on allow SHALL write and return the new `mtime`

#### Scenario: Denied write writes nothing
- **GIVEN** the same request and the operator denies or the prompt expires
- **WHEN** the verdict arrives
- **THEN** the response SHALL be `403` with the denial remedy fields and the file SHALL be unchanged

#### Scenario: A read grant does not admit a write
- **GIVEN** a read-mode grant (any origin) covering `/Users/u/Downloads`
- **WHEN** an allowlisted text-doc write targets `/Users/u/Downloads/x.md`
- **THEN** the write SHALL raise the write prompt, not be admitted

#### Scenario: Bound-checkout roots do not admit writes
- **GIVEN** a text-doc path outside `<cwd>` but under the cwd's bound checkout roots (e.g. a worktree session's parent checkout), with no write-mode grant
- **WHEN** a write is attempted
- **THEN** it SHALL raise the write prompt even though reads there are admitted without one

#### Scenario: A write-mode grant admits writes without a prompt
- **GIVEN** a write-mode grant covering the target's subtree, created by any session or source
- **WHEN** an allowlisted text-doc write targets it
- **THEN** the write SHALL be admitted without a prompt (grants are not per-session)

#### Scenario: Allow once admits only that write
- **GIVEN** the operator answers the write prompt allow-once
- **WHEN** the write completes and a second write to the same path arrives
- **THEN** the first SHALL succeed, no grant SHALL be persisted and the second SHALL prompt again

#### Scenario: Non-text or dashboard-state target never reaches the gate
- **GIVEN** a write-granted directory containing `x.png` and the dashboard state dir
- **WHEN** a write targets either
- **THEN** the response SHALL be `403` without a prompt

#### Scenario: Nonexistent target still prompts, then 404
- **GIVEN** `/Users/u/Downloads/missing.md` does not exist and no write grant covers it
- **WHEN** a prompt-eligible caller POSTs `/api/file/write` and the operator allows
- **THEN** the prompt SHALL have been raised before any existence check and the response SHALL be `404` with nothing written

#### Scenario: Retargeted symlink is refused
- **GIVEN** the grant is given for `x.md` and its symlink is repointed during the hold
- **WHEN** the write resumes
- **THEN** the realpath mismatch SHALL refuse the write and nothing SHALL be written
