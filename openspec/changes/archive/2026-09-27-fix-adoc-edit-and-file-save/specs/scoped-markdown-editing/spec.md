## MODIFIED Requirements

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

The server SHALL gate every text-document write through an `isWritableMdTarget(absPath, { cwd? })` check (realpath-normalized; resolves symlinks via async filesystem I/O). Writable extensions SHALL be exactly the `editable` text kinds: `.md`, `.mdx`, `.adoc`, `.asciidoc`, `.csv`, checked on the realpath target. With a `cwd`, allowed targets SHALL be files of those extensions under `<cwd>/**` (including `<cwd>/.pi/**`). Without a `cwd` (global scope), allowed targets SHALL be limited to `~/.pi/agent/**/*.md`. Paths SHALL be realpath-normalized before the check; symlink or `..` escape and targets of any other extension SHALL be rejected with `403`.

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

#### Scenario: In-scope editable text docs are writable
- **GIVEN** `<cwd>/guide.adoc`, `<cwd>/guide.asciidoc` and `<cwd>/data.csv` exist
- **WHEN** the server evaluates `isWritableMdTarget` with that `cwd`
- **THEN** the check passes for each

#### Scenario: AsciiDoc traversal escape is rejected
- **GIVEN** a write request for `<cwd>/../sibling/evil.adoc`
- **WHEN** the server evaluates `isWritableMdTarget`
- **THEN** the check fails
- **AND** the server responds `403`
