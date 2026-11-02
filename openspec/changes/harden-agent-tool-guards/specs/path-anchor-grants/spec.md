## MODIFIED Requirements

### Requirement: A grant names the subject a recorded denial named, or one of its offered ancestors

A grant request SHALL reference a recorded denial by its identifier, and the granted subject SHALL be either the subject that denial named or one of the **offered ancestors** of that subject as defined by the requirement below. An arbitrary directory SHALL NOT be grantable by supplying it directly to the grant endpoint. An expired or unrecognised denial identifier SHALL be refused.

This binding applies to grant requests made through the dashboard's HTTP grant surfaces and dialog verdicts. A grant created from an agent path-gate verdict is instead bound as defined by the requirement "An agent path-gate verdict may create a grant bound to the gated path and its confirmation", because the gated call is observed by the session itself and produces no recorded HTTP denial. A grant created from an approved provisioning line is instead bound as defined by the requirement "A path grant may originate from an approved provisioning line", because it is created ahead of any denial. The forbidden-subject rules below apply to all three.

The following SHALL be refused as grant subjects regardless of the denial that named them: the filesystem root, the user's home directory, `~/.ssh`, `~/.pi`, the platform system directories (`/etc`, `/usr`, `/var`, `/Library` and their platform equivalents), and the credential directories of the requirement "Credential and browser-profile directories are sensitive grant subjects". Comparison SHALL be against **real paths**, because a system directory may be reached through a symlink (`/etc` resolves to `/private/etc` on macOS) and a home directory may itself be a symlink. The platform system directories SHALL be those of the running platform only: a system-directory literal of another platform SHALL NOT be resolved into a local path, and on Windows they SHALL be taken from the environment where set, so a system drive other than `C:` is covered. No entry outside this list and that requirement's list SHALL be compared against.

The grant endpoint SHALL require authentication and SHALL NOT be invocable cross-origin.

This constrains callers that cannot observe the denial body. It SHALL NOT be claimed to establish operator presence: a local process can read the denial, learn the subject and the identifier, and satisfy the binding itself, because a genuinely local request bypasses authentication in the auth hook itself. Distinguishing the operator from a local process is out of scope for this capability.

#### Scenario: A subject with no matching denial is refused

- **WHEN** a grant is requested for a directory that is neither the subject of a recorded denial nor one of its offered ancestors
- **THEN** the request SHALL be refused and no grant SHALL be recorded

#### Scenario: A directory that is not an ancestor of the denied subject is refused

- **GIVEN** a denial naming `/a/b/c`
- **WHEN** a grant is requested for `/a/b/d`, a sibling rather than an ancestor
- **THEN** the request SHALL be refused and no grant SHALL be recorded

#### Scenario: An expired denial identifier is refused

- **GIVEN** a denial whose registry entry has expired or been evicted
- **WHEN** a grant is requested referencing it
- **THEN** the request SHALL be refused and no grant SHALL be recorded

#### Scenario: A forbidden subject reached through a symlink is refused

- **GIVEN** a denial naming a path that resolves to a system directory (for example `/etc` via `/private/etc`)
- **WHEN** a grant is requested for it
- **THEN** it SHALL be refused — the comparison SHALL be against real paths

#### Scenario: A forbidden subject is refused even when denied

- **GIVEN** a denial named the user's home directory as its containing directory
- **WHEN** a grant is requested for it
- **THEN** the request SHALL be refused and no grant SHALL be recorded

#### Scenario: Cross-origin grant creation is refused

- **WHEN** a grant request arrives from a disallowed origin, or without authentication
- **THEN** it SHALL be refused and no grant SHALL be recorded

#### Scenario: No Windows literals on POSIX

- **GIVEN** a POSIX host
- **WHEN** the forbidden entries are built
- **THEN** they SHALL contain no entry derived from a Windows system-directory literal

#### Scenario: No POSIX literals on Windows

- **GIVEN** a Windows host
- **WHEN** the forbidden entries are built
- **THEN** they SHALL contain no entry derived from a POSIX system-directory literal

#### Scenario: A non-C system drive is covered

- **GIVEN** a Windows host whose system directory is on a drive other than `C:`
- **WHEN** the forbidden entries are built
- **THEN** they SHALL include that system directory

#### Scenario: The server's working directory is not refused by a foreign entry

- **GIVEN** a POSIX host whose server working directory lies below the home directory and contains no listed forbidden subject
- **WHEN** a grant is considered for that working directory or an ancestor of it below the home directory
- **THEN** it SHALL NOT be refused by the forbidden-subject rule

#### Scenario: An ancestor containing a listed subject is still refused

- **GIVEN** a POSIX host
- **WHEN** a grant is considered for the directory that contains the home directory
- **THEN** it SHALL be refused by the forbidden-subject rule

#### Scenario: An agent path-gate grant needs no recorded denial identifier

- **GIVEN** an agent path-gate grant request that satisfies its own session and confirmation binding
- **WHEN** no recorded denial names its subject
- **THEN** the request SHALL NOT be refused for lacking a denial identifier

#### Scenario: A provisioned grant needs no recorded denial identifier

- **GIVEN** a provisioning line approved on a capability-holding connection
- **WHEN** no recorded denial names its subject
- **THEN** the grant SHALL NOT be refused for lacking a denial identifier

#### Scenario: A provisioned forbidden subject is still refused

- **GIVEN** a provisioning line whose real path is a platform system directory
- **WHEN** it is approved
- **THEN** no grant SHALL be recorded

## ADDED Requirements

### Requirement: Credential and browser-profile directories are sensitive grant subjects

`~/.aws`, `~/.config/gh`, `~/.gnupg`, `~/.kube`, `~/.docker`, the file `~/.netrc` and the user-data roots of Chrome, Chromium, Edge, Brave and Firefox on the running platform (list: design D7) SHALL be sensitive like `~/.ssh`: refused as grant, ladder-rung and YOLO subjects when equal to, inside or containing one, and marked sensitive at the agent path gate. One shared constant SHALL serve all consumers.

#### Scenario: A grant for a cloud credential directory is refused
- **WHEN** a grant is requested for `~/.aws` or any directory inside it
- **THEN** the request SHALL be refused and no grant SHALL be recorded

#### Scenario: A directory containing a credential directory is refused
- **WHEN** a grant or YOLO root is requested for `~/.config`
- **THEN** it SHALL be refused and nothing SHALL be recorded

#### Scenario: A rung containing a credential directory is not offered
- **GIVEN** a denial naming `~/.config/app/x`
- **WHEN** the ancestor ladder is computed
- **THEN** no rung SHALL equal, lie inside or contain `~/.config/gh`, and `~/.config/app` SHALL stay offerable

#### Scenario: A browser profile is sensitive
- **WHEN** the agent path gate asks about a file under the Chrome user-data directory of the platform
- **THEN** the prompt SHALL mark the location sensitive and offer only `Allow once` and `Deny`

#### Scenario: The netrc file is sensitive
- **WHEN** the agent path gate asks about `~/.netrc`
- **THEN** the prompt SHALL mark the location sensitive and offer no always-allow

#### Scenario: Netrc siblings are not covered
- **WHEN** the agent path gate asks about `~/.netrc.bak` or, on Windows, `_netrc`
- **THEN** the prompt SHALL NOT mark the location sensitive

### Requirement: A grant store write never discards an entry it does not admit

A persisted grant that is now forbidden SHALL stop admitting, and any write to the grant store file SHALL preserve every entry the load did not admit verbatim, so reverting the build restores them. An unreadable store (invalid JSON, no `grants` array, `version` other than 1) SHALL be moved aside to `<file>.corrupt-<UTC timestamp>` before a record writes a fresh store; a file over 1 MiB SHALL NOT be loaded or rewritten.

#### Scenario: A persisted grant that now matches is neither admitted nor lost
- **GIVEN** the grant store file holds a grant for `~/.aws` written by an older build and one for `/w/other`
- **WHEN** the store is loaded, a new grant is recorded and a grant is revoked
- **THEN** `~/.aws` SHALL NOT admit any path, and the file SHALL still contain the `~/.aws` entry byte-for-byte after each write

#### Scenario: Unrecognised entries survive a write
- **GIVEN** the grant store file holds an entry this build does not accept
- **WHEN** any grant is recorded or revoked
- **THEN** that entry SHALL be preserved in the file verbatim

#### Scenario: An unreadable store is moved aside, not overwritten
- **GIVEN** the grant store file is invalid JSON or has `version: 2`
- **WHEN** a grant is recorded
- **THEN** the old file SHALL exist byte-for-byte as `<file>.corrupt-<timestamp>` and the store SHALL hold the new grant only

#### Scenario: A revoke never rewrites an unreadable store
- **GIVEN** the grant store file is invalid JSON
- **WHEN** a grant is revoked
- **THEN** nothing SHALL be written and the file SHALL be unchanged

#### Scenario: An oversized store is not rewritten
- **GIVEN** the grant store file is larger than 1 MiB
- **WHEN** a grant is recorded
- **THEN** the write SHALL fail, the file SHALL be unchanged and one line SHALL be logged
