## ADDED Requirements

### Requirement: A filesystem denial body names what a grant would store and, to a trusted caller, its prompt outcome

A filesystem denial body SHALL name its subject in exactly the canonical form a
grant for it would be stored in, except when the subject is an existing
non-directory, where the body SHALL name that resource's canonical path and a
grant would store its directory. To a caller that is authenticated or genuinely
local, the body SHALL also carry a prompt outcome from a closed set
(`cannot-ask`, `off`, `not-enforced`, `ineligible`, `busy`, `throttled`,
`recently-answered`, `allowed-elsewhere`, `declined`, `unanswered`,
`ungrantable`, `grant-failed`, `allowed-but-refused`, `unavailable`), carried
identically at sites that suspend requests and at sites that cannot, stating why
the request was not admitted through a dialog. An ungrantable subject SHALL be
reported as `ungrantable` at any site where the access-grant coordinator is
installed; otherwise a site that cannot suspend a request SHALL report
`cannot-ask`. The predicate deciding disclosure SHALL be the
one that governs the access block of the health endpoint, and it SHALL be
evaluated at every site that returns a denial body carrying remedy fields,
including sites that cannot suspend a request. A reason outside the known mapping SHALL be reported as
`unavailable`. Existing body fields SHALL keep their names.

#### Scenario: A symlinked directory is named by its canonical path

- **GIVEN** a denied path under a directory that resolves through a symlink (for example `/tmp` to `/private/tmp`)
- **WHEN** the denial body is returned
- **THEN** its subject SHALL be the resolved directory

#### Scenario: The body and the dialog name the same subject

- **GIVEN** an eligible filesystem denial that raises a dialog
- **WHEN** the denial body and the dialog request are compared
- **THEN** they SHALL name the same subject

#### Scenario: A canonical body still binds a grant

- **GIVEN** a denial body naming a canonical subject
- **WHEN** a grant is requested for that subject with the denial's identifier
- **THEN** the grant SHALL be accepted

#### Scenario: The outcome is withheld from an untrusted caller

- **GIVEN** a caller admitted to the file route that is neither authenticated nor genuinely local
- **WHEN** a filesystem read is denied
- **THEN** the body SHALL NOT carry a prompt outcome

#### Scenario: Prompting disabled is reported to a local caller

- **GIVEN** prompting is disabled and a genuinely local caller
- **WHEN** a filesystem read is denied at a site that can suspend requests
- **THEN** the body's prompt outcome SHALL be `off`

#### Scenario: Report mode is reported distinctly

- **GIVEN** prompting is enabled, the host gate is in report mode, and a genuinely local caller
- **WHEN** a filesystem read is denied at a site that can suspend requests
- **THEN** the body's prompt outcome SHALL be `not-enforced`

#### Scenario: A recently answered subject is reported

- **GIVEN** a subject whose dialog was answered moments ago and a genuinely local caller
- **WHEN** an eligible read of that subject is denied again
- **THEN** the body's prompt outcome SHALL be `recently-answered`

#### Scenario: A site that cannot suspend reports it

- **GIVEN** a genuinely local caller and a grantable subject
- **WHEN** a read is denied at a site that cannot suspend a request
- **THEN** the body's prompt outcome SHALL be `cannot-ask`

#### Scenario: Ungrantable wins over a site that cannot suspend

- **GIVEN** a genuinely local caller and an ungrantable subject
- **WHEN** a read is denied at a site that cannot suspend a request
- **THEN** the body's prompt outcome SHALL be `ungrantable`

#### Scenario: A request joining an existing entry reports its own eligibility

- **GIVEN** a genuinely local caller, prompting enabled, the host gate enforcing, and a pending entry for a directory
- **WHEN** a declared-ineligible read of another file in that directory is denied
- **THEN** the body's prompt outcome SHALL be `ineligible`

#### Scenario: Every denial body site applies the disclosure predicate

- **GIVEN** a caller that is neither authenticated nor genuinely local
- **WHEN** a read is denied at any site that returns a denial body carrying remedy fields, including the session-file read
- **THEN** the body SHALL NOT carry a prompt outcome

## MODIFIED Requirements

### Requirement: A grant names the subject a recorded denial named, or one of its offered ancestors

A grant request SHALL reference a recorded denial by its identifier, and the granted subject SHALL be either the subject that denial named or one of the **offered ancestors** of that subject as defined by the requirement below. An arbitrary directory SHALL NOT be grantable by supplying it directly to the grant endpoint. An expired or unrecognised denial identifier SHALL be refused.

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
