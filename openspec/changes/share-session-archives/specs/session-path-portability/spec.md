## ADDED Requirements

### Requirement: Machine-specific paths SHALL be replaced by placeholders on export

Before publication, absolute paths SHALL be replaced by placeholder tokens:
paths inside the project root by `{{CWD}}`, and all other home-relative paths by
`{{HOME:remote}}`. Substitution SHALL be applied longest-prefix-first. The
archive SHALL NOT contain the source machine's absolute project path or home
path in any transcript body, metadata value, or object key.

Username erasure is explicitly NOT required: a transcript legitimately contains
usernames in `ls -la` output, git author lines, and remote URLs, and erasing an
identity from free text is out of scope.

#### Scenario: A project path is tokenised

- **GIVEN** project root `/Users/robson/Project/pi-agent-dashboard` under home
  `/Users/robson`
- **WHEN** a transcript entry contains
  `/Users/robson/Project/pi-agent-dashboard/packages/server/src/server.ts`
- **THEN** the exported entry contains
  `{{CWD}}/packages/server/src/server.ts`

#### Scenario: A path outside the project is marked as foreign

- **WHEN** a transcript entry contains `/Users/robson/.agent-browser/tmp/x.png`
- **THEN** the exported entry contains `{{HOME:remote}}/.agent-browser/tmp/x.png`

#### Scenario: Prefix matching is component-bounded

- **GIVEN** project root `/Users/robson/Project/dashboard`
- **WHEN** a transcript entry contains
  `/Users/robson/Project/dashboard-other/file.ts`
- **THEN** the entry is NOT tokenised as `{{CWD}}-other/file.ts`
- **AND** no token is emitted whose expansion would name a different directory

#### Scenario: A path under neither the project root nor home is left verbatim

- **WHEN** a transcript entry contains `/private/var/folders/ab/tmp.XYZ/file.ts`
- **THEN** the entry is exported unchanged
- **AND** the archive still contains no project path and no home path

#### Scenario: No token expands to a fabricated local path

- **WHEN** any home-relative path outside the project root is exported
- **THEN** it carries `{{HOME:remote}}`
- **AND** no token is emitted whose expansion would synthesise a target path that
  the archive cannot guarantee exists

#### Scenario: The archive is free of source-machine paths

- **WHEN** an exported archive for a project is scanned
- **THEN** no transcript body, metadata value, manifest entry, or object key
  contains the source home path or the source project path

### Requirement: Substitution SHALL cover every published value

Scrubbing SHALL be applied to transcript bodies, session metadata, goals, and
provenance records. Encryption SHALL NOT be treated as a substitute for
substitution.

#### Scenario: Session metadata is scrubbed

- **WHEN** session metadata carrying an absolute `cwd` is published
- **THEN** the published metadata carries a placeholder token, not the absolute
  path

#### Scenario: Goal records are scrubbed

- **WHEN** a goal record carrying an absolute `cwd` is published
- **THEN** the published record carries a placeholder token, not the absolute
  path

### Requirement: Projects SHALL be addressed by a projectKey, never by path

An archive SHALL identify a project by `projectKey`, derived from the
**canonicalised** git remote URL when the project is a git repository and
otherwise from a user-assigned name. Canonicalisation SHALL strip the scheme,
userinfo, `.git` suffix, and trailing slash, and SHALL lowercase the host. The
path-derived session slug directory name SHALL NOT be used as an archive
identifier.

#### Scenario: A git-backed project derives its key from the remote

- **WHEN** a project with a configured git remote is exported
- **THEN** its `projectKey` is derived from the canonicalised remote URL
- **AND** the same project cloned to a different path on another machine
  resolves to the same `projectKey`

#### Scenario: Equivalent remote URL forms resolve to one key

- **WHEN** `git@github.com:user/repo.git` and `https://github.com/user/repo` are
  canonicalised
- **THEN** both yield the same `projectKey`
- **AND** the SCP-style `host:path` separator has been rewritten to `host/path`
  so the two forms do not differ by a colon

#### Scenario: A project without a git remote requires an assigned name

- **WHEN** a project has no git remote and no assigned name
- **THEN** export is refused with an error requesting a project name

### Requirement: Scrubbing SHALL be structural and SHALL NOT alter image payloads

Substitution SHALL operate on parsed transcript entries and SHALL skip inline
image block payload fields. Substitution SHALL NOT modify any byte of an
attachment's base64 payload.

#### Scenario: An attachment digest survives the round trip

- **GIVEN** a transcript containing an inline image whose `attachmentId` is the
  SHA-256 of its original base64 text
- **WHEN** the session is exported, scrubbed, and reimported
- **THEN** the recomputed `attachmentId` is unchanged
- **AND** the original image is recoverable from the reimported transcript

#### Scenario: A path-like byte sequence inside base64 is not substituted

- **GIVEN** an inline image whose base64 payload contains a byte run matching the
  source home path
- **WHEN** the session is exported
- **THEN** the payload bytes are unchanged

### Requirement: Placeholders SHALL be expanded to local paths on import

On import, `{{CWD}}` SHALL expand to the target project root.
`{{HOME:remote}}` SHALL NOT be expanded. Literal occurrences of either token in
content SHALL be escaped on scrub and unescaped on expand, symmetrically for
both tokens.

#### Scenario: A session imports onto a differently-rooted machine

- **GIVEN** an archive exported from `/Users/robson/Project/pi-agent-dashboard`
- **WHEN** it is imported on a machine whose project root is
  `/home/bob/dev/dashboard`
- **THEN** transcript entries reference `/home/bob/dev/dashboard/...`
- **AND** the rehydrated session is written to the target machine's slug
  directory for that root

#### Scenario: A session whose cwd is a subdirectory of the project root

- **GIVEN** a session whose cwd is a git worktree or subdirectory beneath the
  project root
- **WHEN** it is exported and imported
- **THEN** the root-relative offset is preserved
- **AND** the imported session's cwd is the corresponding path beneath the target
  project root

#### Scenario: A session whose cwd is outside the project root is reported as non-resumable

- **GIVEN** a session whose cwd is a git worktree outside the project root
- **WHEN** it is exported and listed on another machine
- **THEN** it is marked as non-resumable on that machine
- **AND** importing it does not silently produce a session with an unresolvable
  cwd

#### Scenario: A literal token in content survives import

- **GIVEN** a transcript whose prose contains the literal text `{{HOME:remote}}`
- **WHEN** the session is exported and imported
- **THEN** the prose still contains the literal text `{{HOME:remote}}`
- **AND** re-sealing on the importing machine produces the same canonical bytes
  as the origin did for that content

#### Scenario: Foreign paths remain visibly unresolved

- **WHEN** an entry containing `{{HOME:remote}}/.agent-browser/tmp/x.png` is
  imported
- **THEN** the token is not expanded to a local path
