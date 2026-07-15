# tool-output-linkification Specification

## ADDED Requirements

### Requirement: Server-side file-mention resolution

The server SHALL expose an endpoint that resolves file mentions against the real
filesystem. Given a `cwd` and a list of mention strings, for each mention the
server SHALL return whether it resolves to a real, in-scope file and, when it
does, the resolved absolute path and the resolution kind.

Resolution order per mention: expand a leading `~/` to the user home directory
(`os.homedir()`); then attempt the mention as an absolute path; then as a path
relative to `cwd`. A leading `~user/` (other users' homes) MUST NOT be expanded.
Every candidate path MUST pass the existing anti-traversal containment gate
(cwd anchor with git-common-root widening) BEFORE any filesystem stat, so a
crafted `~/../../etc/passwd` resolves to no file. A mention that does not resolve
to an existing in-scope file MUST return a null resolution (never an error that
blocks the batch).

#### Scenario: tilde home path resolves under home
- **WHEN** the client requests resolution of `~/.pi/agent/settings.json` (which exists)
- **THEN** the server SHALL return a resolution with path `<os.homedir()>/.pi/agent/settings.json` and kind `tilde`

#### Scenario: relative mention resolves against cwd
- **WHEN** the client requests resolution of `packages/server/src/routes/file-routes.ts` with a cwd where that file exists
- **THEN** the server SHALL return a resolution rooted at cwd with kind `relative`

#### Scenario: nonexistent mention returns null
- **WHEN** the client requests resolution of `foo.ts` and no such file is in scope
- **THEN** the server SHALL return a null resolution for that mention (no error)

#### Scenario: tilde traversal escape blocked
- **WHEN** the client requests resolution of `~/../../etc/passwd`
- **THEN** the server SHALL expand the tilde, the containment gate SHALL reject the path, and the resolution SHALL be null

### Requirement: Links render only after server confirmation

A detected file-mention candidate SHALL render as an openable link only after
the server confirms it resolves to a real in-scope file. A candidate whose
server resolution is null MUST render as plain text, not as a clickable link,
so loosened client detection never produces a dead link. The client MAY batch
the mentions visible in a message into a single resolution request and SHALL
cache each result keyed by `(cwd, mention)`.

#### Scenario: unresolved candidate stays plain text
- **WHEN** the client detects `Node.js` or a documentation example `foo.ts` that the server resolves to null
- **THEN** the span SHALL render as plain text with no link affordance

#### Scenario: resolved candidate becomes a link
- **WHEN** the server confirms a detected mention resolves to an existing file
- **THEN** the span SHALL render as a clickable link whose open target is the server-resolved path

### Requirement: Fuzzy fallback resolves only on a unique match

The server SHALL, when exact resolution (absolute / tilde / relative-to-cwd) misses, optionally search for the mention's basename among the repository's tracked files (bounded). A fuzzy match SHALL resolve the mention ONLY when
exactly one tracked file matches; when the mention's basename matches more than
one tracked file, the server MUST return a null resolution and MUST NOT
auto-select any single candidate. Fuzzy search MUST remain scoped inside the
cwd / git common root.

#### Scenario: unique basename resolves
- **WHEN** the mention `monaco-setup.ts` matches exactly one tracked file in the repo
- **THEN** the server SHALL resolve the mention to that file

#### Scenario: colliding basename refuses to resolve
- **WHEN** the mention `tasks.md` matches many tracked files
- **THEN** the server SHALL return a null resolution and MUST NOT pick any single `tasks.md`

#### Scenario: fuzzy disabled outside a repo
- **WHEN** the cwd is not inside a git repository (no tracked-file listing)
- **THEN** fuzzy fallback SHALL be skipped and resolution SHALL rely on exact matching only
