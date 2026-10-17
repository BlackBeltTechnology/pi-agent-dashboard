## MODIFIED Requirements

### Requirement: Write target authorization SHALL be allowlist-bounded

The server SHALL gate every text-document write through an `isWritableMdTarget(absPath, { cwd? })` check (realpath-normalized; resolves symlinks via async filesystem I/O). Writable extensions SHALL be the `editable` text kinds `.md`, `.mdx`, `.adoc`, `.asciidoc`, `.csv` plus, in directory scope only, the Mermaid source files `.mmd`, `.mermaid`, checked on the realpath target. With a `cwd`, allowed targets SHALL be files of those extensions under `<cwd>/**` (including `<cwd>/.pi/**`). Without a `cwd` (global scope), allowed targets SHALL be limited to `~/.pi/agent/**/*.md`. Paths SHALL be realpath-normalized before the check; symlink or `..` escape and targets of any other extension SHALL be rejected with `403`.

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
- **GIVEN** `<cwd>/flow.mmd` is a symlink resolving to a `.mmd` file outside `<cwd>`
- **WHEN** the server evaluates `isWritableMdTarget` with that `cwd`
- **THEN** the check fails
- **AND** the server responds `403`

#### Scenario: AsciiDoc traversal escape is rejected
- **GIVEN** a write request for `<cwd>/../sibling/evil.adoc`
- **WHEN** the server evaluates `isWritableMdTarget`
- **THEN** the check fails
- **AND** the server responds `403`
