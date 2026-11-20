## MODIFIED Requirements

### Requirement: Write target authorization SHALL be allowlist-bounded

The server SHALL gate every text-document write through an `isWritableMdTarget(absPath, { cwd? })` check (realpath-normalized; resolves symlinks via async filesystem I/O). Writable extensions SHALL be the `editable` text kinds `.md`, `.mdx`, `.adoc`, `.asciidoc`, `.csv` plus, in directory scope only, the Mermaid source files `.mmd`, `.mermaid`, checked on the realpath target. With a `cwd`, allowed targets SHALL be files of those extensions under `<cwd>/**` (including `<cwd>/.pi/**`). A target outside `<cwd>` SHALL be refused unless a path grant admits it (see "An out-of-cwd write SHALL be gated by the path grant prompt"). Without a `cwd` (global scope), allowed targets SHALL be limited to `~/.pi/agent/**/*.md`. Paths SHALL be realpath-normalized before the check; symlink or `..` escape without such a grant, and targets of any other extension, SHALL be rejected with `403`.

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
- **GIVEN** `<cwd>/flow.mmd` is a symlink resolving to a `.mmd` file outside `<cwd>` (Mermaid sources never reach the grant gate)
- **WHEN** the server evaluates `isWritableMdTarget` with that `cwd`
- **THEN** the check fails
- **AND** the server responds `403`

#### Scenario: AsciiDoc traversal escape is rejected
- **GIVEN** a write request for `<cwd>/../sibling/evil.adoc` and no grant covering `sibling`
- **WHEN** the server evaluates `isWritableMdTarget`
- **THEN** the check fails
- **AND** the server responds `403`

#### Scenario: Out-of-cwd text doc is not rejected outright
- **GIVEN** a write request for `/Users/u/Downloads/x.md` with a `cwd` and a covering grant
- **WHEN** the server evaluates the write
- **THEN** `isWritableMdTarget` fails but the grant gate admits it and the write proceeds

## ADDED Requirements

### Requirement: An out-of-cwd write SHALL be gated by the path grant prompt

In directory scope, a write whose realpath is outside `<cwd>`, has an allowlisted text-doc extension (not Mermaid) and is not refused for dashboard state SHALL pass the same containment/grant check as reads, anchored at `<cwd>` only. An un-granted miss SHALL suspend for the operator prompt; denial, expiry or an ineligible caller SHALL answer `403` with the denial remedy and write nothing. If the target's realpath differs when written, nothing SHALL be written. Global scope is unchanged.

#### Scenario: Un-granted write raises the grant prompt
- **GIVEN** `/Users/u/Downloads/x.md` outside the cwd and no grant
- **WHEN** a prompt-eligible caller POSTs `/api/file/write`
- **THEN** the request SHALL suspend for the grant prompt, and on allow SHALL write and return the new `mtime`

#### Scenario: Denied write writes nothing
- **GIVEN** the same request and the operator denies or the prompt expires
- **WHEN** the verdict arrives
- **THEN** the response SHALL be `403` with the denial remedy fields and the file SHALL be unchanged

#### Scenario: Git-root widening does not admit writes
- **GIVEN** a path inside the repo's git common root but outside `<cwd>`, with no grant
- **WHEN** a write is attempted
- **THEN** the write SHALL NOT be admitted by the widened read anchors

#### Scenario: Non-text or dashboard-state target never reaches the gate
- **GIVEN** a granted directory containing `x.png` and the dashboard state dir
- **WHEN** a write targets either
- **THEN** the response SHALL be `403` without a prompt

#### Scenario: Retargeted symlink is refused
- **GIVEN** the grant is given for `x.md` and its symlink is repointed during the hold
- **WHEN** the write resumes
- **THEN** the realpath mismatch SHALL refuse the write and nothing SHALL be written
