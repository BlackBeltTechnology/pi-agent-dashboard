## MODIFIED Requirements

### Requirement: Out-of-root path tool calls are gated before execution

When the gate is enabled, the system SHALL evaluate every `read`, `write` and `edit` tool call of a pi session before the tool executes. The target path SHALL be resolved by the same rules the tool itself applies to its path argument (including home-directory expansion, a leading `@` marker, whitespace normalisation, and resolution against the session working directory), and SHALL then be canonicalised to the location the tool would actually open or create before comparison: existing path components through their real path, and a symlink whose own target does not exist (a dangling symlink) followed to that target. The link text SHALL be resolved component by component from the link's real parent directory, as the operating system resolves it: absolute link text starts from its root, a `..` component takes the parent of the already-resolved prefix, and any existing component SHALL be resolved through its real path before the next component is applied. The hop bound SHALL count every link followed for one call. A chain of symlinks that cannot be resolved within a bounded number of hops SHALL count as the gate erroring. Containment SHALL be decided component-wise, never by string prefix, with case sensitivity taken from the filesystem. A call whose canonical target lies within the session's roots SHALL proceed without a prompt. A call whose canonical target lies outside them SHALL NOT execute unless the operator allows it, or a live YOLO session the operator activated answers it as defined by the YOLO requirement of this capability. No other tool SHALL be gated by this capability.

#### Scenario: In-root read proceeds silently

- **GIVEN** a session whose working directory is `/w/repo`
- **WHEN** the agent reads `/w/repo/src/a.ts`
- **THEN** the tool SHALL run and no prompt SHALL be raised

#### Scenario: Out-of-root read asks first

- **GIVEN** a session whose working directory is `/w/repo` and no YOLO session is live
- **WHEN** the agent reads `/w/other/secret.txt`
- **THEN** the tool SHALL NOT run until the operator answers

#### Scenario: Relative traversal is resolved before comparison

- **GIVEN** a session whose working directory is `/w/repo`
- **WHEN** the agent reads `../other/x.txt`
- **THEN** the call SHALL be treated as a read of `/w/other/x.txt` and asked about

#### Scenario: Home-directory shorthand is resolved as the tool resolves it

- **GIVEN** a session whose working directory is `/w/repo`
- **WHEN** the agent reads `~/.ssh/id_rsa`
- **THEN** the call SHALL be treated as a read of the file in the user's home directory and asked about, not as a path inside `/w/repo`

#### Scenario: A leading @ marker is resolved as the tool resolves it

- **WHEN** the agent writes `@/etc/hosts`
- **THEN** the call SHALL be treated as a write of `/etc/hosts` and asked about

#### Scenario: A string-prefix sibling is not inside the root

- **GIVEN** a session whose working directory is `/w/repo`
- **WHEN** the agent reads `/w/repo-old/a.txt`
- **THEN** the call SHALL be asked about

#### Scenario: A symlink inside the root pointing outside is asked about

- **GIVEN** `/w/repo/link` is a symlink to `/w/other`
- **WHEN** the agent writes `/w/repo/link/f.txt`
- **THEN** the call SHALL be treated as a write of `/w/other/f.txt` and asked about

#### Scenario: A dangling symlink inside the root pointing outside is asked about

- **GIVEN** `/w/repo/link` is a symlink to the not-yet-existing `/w/other/new.txt`
- **WHEN** the agent writes `/w/repo/link`
- **THEN** the call SHALL be treated as a write of `/w/other/new.txt` and asked about

#### Scenario: A relative dangling link under a symlinked directory is resolved from its real parent

- **GIVEN** `/w/repo/s` is a symlink to `/w/other/deep`, and `/w/other/deep/link` is a symlink to the not-yet-existing `../new.txt`
- **WHEN** the agent writes `/w/repo/s/link`
- **THEN** the call SHALL be treated as a write of `/w/other/new.txt` and asked about

#### Scenario: Other tools are not gated

- **WHEN** the agent runs `bash` with `cat /w/other/secret.txt`
- **THEN** this capability SHALL NOT raise a prompt or block the call
