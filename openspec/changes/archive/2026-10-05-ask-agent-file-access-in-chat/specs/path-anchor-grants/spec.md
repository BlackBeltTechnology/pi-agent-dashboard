## MODIFIED Requirements

### Requirement: A grant names the subject a recorded denial named, or one of its offered ancestors

A grant request SHALL reference a recorded denial by its identifier, and the granted subject SHALL be either the subject that denial named or one of the **offered ancestors** of that subject as defined by the requirement below. An arbitrary directory SHALL NOT be grantable by supplying it directly to the grant endpoint. An expired or unrecognised denial identifier SHALL be refused.

This binding applies to grant requests made through the dashboard's HTTP grant surfaces and dialog verdicts. A grant created from an agent path-gate verdict is instead bound as defined by the requirement "An agent path-gate verdict may create a grant bound to the gated path and its confirmation", because the gated call is observed by the session itself and produces no recorded HTTP denial. The forbidden-subject rules below apply to both.

The following SHALL be refused as grant subjects regardless of the denial that named them: the filesystem root, the user's home directory, `~/.ssh`, `~/.pi`, and the platform system directories (`/etc`, `/usr`, `/var`, `/Library` and their platform equivalents). Comparison SHALL be against **real paths**, because a system directory may be reached through a symlink (`/etc` resolves to `/private/etc` on macOS) and a home directory may itself be a symlink. The platform system directories SHALL be those of the running platform only: a system-directory literal of another platform SHALL NOT be resolved into a local path, and on Windows they SHALL be taken from the environment where set, so a system drive other than `C:` is covered. No entry outside this list SHALL be compared against.

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

## ADDED Requirements

### Requirement: An agent path-gate verdict may create a grant bound to the gated path and its confirmation

A path-anchor grant SHALL be creatable from an operator's confirmed always-allow answer to an agent path-gate prompt. Such a request SHALL be accepted only when all of the following hold: it arrives over the connection of the pi session whose call was gated; it names the confirmation prompt that session raised for that path; the dashboard observed that confirmation prompt being raised for the same session and path; that confirmation has not already been used for a grant, has not expired, and was not cancelled or withdrawn; and the subject the request names is the subject that confirmation named. A replay of the same confirmation SHALL NOT extend its lifetime. If the subject derived at grant time differs from the subject the confirmation named (the directory was created, renamed or retargeted in between), the request SHALL be refused. The dashboard cannot observe how a confirmation was answered (an answer given in the terminal UI never reaches it); that the operator confirmed is the session's assertion. The request SHALL carry the gated path rather than a chosen directory; the store SHALL derive the subject itself as that path's containing directory (or the path, when it is a directory), realpath'd at grant time. It SHALL NOT be possible to name an ancestor or any other directory through this request. The forbidden-subject rules SHALL apply unchanged. The grant SHALL be project-scoped, SHALL record the gated session as its origin, and SHALL be distinguishable in the Access surface as agent-prompted.

This binding guards against cross-session, misrouted, replayed and path-substituted requests. Like the denial-identifier binding, it SHALL NOT be claimed to establish operator presence against a local process running as the same user.

#### Scenario: Grant subject is derived from the gated path

- **WHEN** a session's confirmed always-allow for a gated read of `/w/other/docs/a.md` is recorded
- **THEN** the stored subject SHALL be the real path of `/w/other/docs`

#### Scenario: A request from another session is refused

- **WHEN** an agent path-gate grant request names a session other than the one bound to the connection it arrives on, or arrives on no session connection
- **THEN** it SHALL be refused and no grant SHALL be recorded

#### Scenario: A request without an observed confirmation is refused

- **WHEN** an agent path-gate grant request names a confirmation the dashboard never saw raised for that session and path
- **THEN** it SHALL be refused and no grant SHALL be recorded

#### Scenario: A cancelled confirmation cannot be redeemed

- **GIVEN** a confirmation withdrawn because the gate timed out
- **WHEN** a grant request names it
- **THEN** it SHALL be refused and no grant SHALL be recorded

#### Scenario: A subject that changed after confirmation is refused

- **GIVEN** a confirmation that named `/w/other/docs`
- **WHEN** `/w/other/docs` is replaced by a symlink to `/w/secret` before the grant request is processed
- **THEN** the request SHALL be refused and no grant SHALL be recorded

#### Scenario: A confirmation is single use

- **GIVEN** a confirmation already used to record a grant
- **WHEN** a second grant request names the same confirmation
- **THEN** it SHALL be refused and no further grant SHALL be recorded

#### Scenario: A path differing from the confirmed path is refused

- **GIVEN** a confirmation raised for `/w/other/docs/a.md`
- **WHEN** a grant request names that confirmation with the path `/w/secret/a.md`
- **THEN** it SHALL be refused and no grant SHALL be recorded

#### Scenario: Forbidden subject is refused

- **WHEN** an agent path-gate grant request carries a path whose containing directory is the user's home directory
- **THEN** it SHALL be refused and no grant SHALL be recorded

#### Scenario: Access surface labels the origin

- **WHEN** an agent path-gate grant is listed in Settings ▸ Access
- **THEN** it SHALL be shown as originating from an agent prompt, with the session that requested it

#### Scenario: Revocation applies to the agent gate

- **GIVEN** an agent path-gate grant `/w/other/docs`
- **WHEN** it is revoked
- **THEN** it SHALL stop admitting `/w/other/docs` for both dashboard file routes and the agent path gate
