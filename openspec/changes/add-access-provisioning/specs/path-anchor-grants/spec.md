## MODIFIED Requirements

### Requirement: A grant names the subject a recorded denial named, or one of its offered ancestors

A grant request SHALL reference a recorded denial by its identifier, and the granted subject SHALL be either the subject that denial named or one of the **offered ancestors** of that subject as defined by the requirement below. An arbitrary directory SHALL NOT be grantable by supplying it directly to the grant endpoint. An expired or unrecognised denial identifier SHALL be refused.

This binding applies to grant requests made through the dashboard's HTTP grant surfaces and dialog verdicts. A grant created from an agent path-gate verdict is instead bound as defined by the requirement "An agent path-gate verdict may create a grant bound to the gated path and its confirmation", because the gated call is observed by the session itself and produces no recorded HTTP denial. A grant created from an approved provisioning line is instead bound as defined by the requirement "A path grant may originate from an approved provisioning line", because it is created ahead of any denial. The forbidden-subject rules below apply to all three.

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

#### Scenario: A provisioned grant needs no recorded denial identifier

- **GIVEN** a provisioning line approved on a capability-holding connection
- **WHEN** no recorded denial names its subject
- **THEN** the grant SHALL NOT be refused for lacking a denial identifier

#### Scenario: A provisioned forbidden subject is still refused

- **GIVEN** a provisioning line whose real path is a platform system directory
- **WHEN** it is approved
- **THEN** no grant SHALL be recorded

### Requirement: The grant store is bounded at 200 entries

The grant store SHALL hold at most 200 entries **per scope**. When recording a grant would exceed that bound, the oldest entry by grant time **within the same scope** SHALL be evicted first. The bound exists because every containment miss scans the store linearly with a `realpath` per entry, so an unbounded store is an unbounded cold-path cost.

Eviction SHALL NOT cross scopes: an in-memory session grant SHALL NOT cause a persisted project grant to be removed from disk. A grant written from an approved provisioning line SHALL NOT evict: when the bound would be exceeded, that write SHALL be refused instead and no existing grant SHALL be removed. A provisioned grant SHALL NOT be chosen for eviction: another write at the bound SHALL evict the oldest non-provisioned grant, or be refused when every grant is provisioned. Every eviction SHALL be logged.

Eviction SHALL narrow what is admitted, never widen it: an evicted subject SHALL be refused on its next read exactly as an ungranted subject is, and MAY be granted again from the resulting denial.

#### Scenario: Recording past the bound evicts the oldest grant

- **GIVEN** the store holds 200 grants
- **WHEN** a further grant is recorded
- **THEN** the store SHALL still hold 200 entries
- **AND** the entry with the oldest grant time SHALL no longer be present

#### Scenario: A session grant never evicts a project grant

- **GIVEN** 200 project-scoped grants are persisted
- **WHEN** session-scoped grants are recorded past the session bound
- **THEN** every persisted project grant SHALL remain in the store

#### Scenario: An evicted subject is refused again

- **GIVEN** a grant for `/a/b` was evicted by the bound
- **WHEN** a path under `/a/b` is read and no other layer admits it
- **THEN** it SHALL be refused with HTTP 403

#### Scenario: A provisioning write at the bound is refused, not evicting

- **GIVEN** the store holds 200 grants
- **WHEN** a grant from an approved provisioning line is recorded
- **THEN** it SHALL be refused
- **AND** all 200 existing grants SHALL remain

#### Scenario: A provisioned grant is never evicted

- **GIVEN** the store holds 200 grants and the oldest was provisioned
- **WHEN** a grant from a denial verdict is recorded
- **THEN** the oldest non-provisioned grant SHALL be evicted and the provisioned grant SHALL remain

#### Scenario: A store full of provisioned grants refuses a denial-path grant

- **GIVEN** the store holds 200 provisioned grants
- **WHEN** a grant from a denial verdict is recorded
- **THEN** it SHALL be refused and all 200 grants SHALL remain

## ADDED Requirements

### Requirement: A path grant may originate from an approved provisioning line

A persisted path grant SHALL be creatable from a provisioning line the operator approved on a capability-holding connection. Its subject SHALL be the line's real path re-resolved at approval time. It SHALL be persisted (`scope: "project"`, machine-wide by folder), record the project root as origin, and be shown as provisioned; in effect and revocation it SHALL equal any other grant.

#### Scenario: A provisioned grant admits its subtree

- **WHEN** a provisioning line for `/w/lib` is approved
- **THEN** the grant SHALL admit `/w/lib` and everything below it, and nothing outside it

#### Scenario: A provisioned grant is revocable

- **WHEN** a provisioned grant is revoked on the Access page
- **THEN** it SHALL stop admitting its subtree on the next request

#### Scenario: An unapproved line creates no grant

- **WHEN** a provisioning line is rejected, its request expires, or its dialog is dismissed
- **THEN** no grant SHALL be created for it
