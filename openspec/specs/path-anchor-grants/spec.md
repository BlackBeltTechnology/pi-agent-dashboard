# path-anchor-grants Specification

## Purpose
TBD - created by archiving change add-access-grants-and-review. Update Purpose after archive.

## Requirements

### Requirement: Persisted path-anchor grant store

The system SHALL persist granted filesystem directories at `~/.pi/dashboard/access-grants.json`. Each entry SHALL record the granted directory subject, its scope, the time it was granted, and the origin that requested it. A missing or malformed store SHALL be treated as empty.

This store is deliberately richer than `worktree-init-trust.json`, which is a flat map of key to `true` carrying no subject, time, or origin — those three fields are required here because the Access tab must display them. Scope SHALL follow the existing `"session" | "project"` convention, where a session-scoped grant lives only in memory and does not survive a restart.

#### Scenario: First grant creates the store

- **GIVEN** no grant store file exists
- **WHEN** a user grants a directory
- **THEN** the store SHALL be created containing that subject

#### Scenario: Malformed store degrades to empty

- **WHEN** the store file is unreadable or not valid JSON
- **THEN** it SHALL be treated as holding no grants
- **AND** containment SHALL fall back to derived anchors only

#### Scenario: Project-scoped grants survive restart

- **GIVEN** a subject was granted at project scope
- **WHEN** the server restarts
- **THEN** the grant SHALL still be in effect

#### Scenario: Session-scoped grants do not survive restart

- **GIVEN** a subject was granted at session scope
- **WHEN** the server restarts
- **THEN** the grant SHALL no longer be in effect

### Requirement: Grant subject is a directory, stored as a real path

A grant subject SHALL be a directory, not an individual file path. When a denial concerns a file, the subject offered for grant SHALL be that file's containing directory.

The subject SHALL be resolved through `realpath` at the moment the grant is recorded, and the resolved value SHALL be what is persisted and what any review surface displays. The stored subject SHALL NOT be re-resolved at check time: it is already a real path, and re-resolving it would let a symlink later swapped in over the subject — or over any ancestor of it — silently move the grant, which is the exact failure this requirement exists to prevent. Persisting the lexical path instead would let the admitted set follow a symlink's later retargeting: a grant of a symlinked directory would silently admit whatever that symlink is repointed at, without the user ever approving the new target. Storing the real path binds the grant to the directory the user actually saw when granting.

#### Scenario: File denial offers its directory

- **WHEN** a read of `/a/b/c.txt` is refused by containment
- **THEN** the grant subject SHALL be `/a/b`

#### Scenario: A symlinked subject is stored as its target

- **GIVEN** `/wt/current` is a symlink to `/wt/v1`
- **WHEN** `/wt/current` is granted
- **THEN** the persisted subject SHALL be `/wt/v1`

#### Scenario: Retargeting a symlinked subject does not move the grant

- **GIVEN** `/wt/current` was granted while pointing at `/wt/v1`
- **WHEN** `/wt/current` is later repointed at `/wt/v2`
- **THEN** reads under `/wt/v2` SHALL be refused, because the grant is bound to `/wt/v1`

#### Scenario: Granted directory covers later reads within it

- **GIVEN** `/a/b` has been granted
- **WHEN** `/a/b/d.txt` is later read
- **THEN** it SHALL be allowed without any further user action

### Requirement: A grant admits its own subtree and nothing more

A persisted grant SHALL be evaluated by a dedicated subtree check — the resolved path is the granted directory or lies under it — applied only after the existing containment layers have already refused.

A grant SHALL NOT be supplied to `isAllowed` as an additional anchor. That function performs a bound-checkout-root widening pass over every anchor it receives (`thisCheckout` and `mainCheckout`, per `git-checkout-root-resolution`), so supplying a granted subdirectory as an anchor would silently admit the entire checkout containing it. The grant check SHALL perform no checkout-root resolution and no widening of any kind.

The grant check SHALL resolve symlinks on the **requested path** before comparing, and SHALL compare against the stored subject verbatim. A lexical-only comparison of the requested path would allow a symlink inside a granted directory to reach a target outside it.

The check SHALL be evaluated **after** every pre-existing admission at the site, including the image-only artifact-root admission at `file-routes.ts:746` (`isImageUnderArtifactRoot`, labelled "Layer ③" in source). This capability refers to its own check as the **grant layer** rather than a layer number, so it does not collide with that existing numbering.

The check SHALL read the grant set from memory, never with a synchronous file read on the containment path, and SHALL short-circuit when the grant set is empty without performing any filesystem syscall. The containment module is asynchronous by deliberate design; a synchronous read would stall unrelated requests. The empty-store short-circuit matters because `grep-routes.ts:60` evaluates containment once per grep match, so any per-check cost is multiplied by the match count.

#### Scenario: Empty store preserves current behaviour

- **GIVEN** the grant store holds no entries
- **WHEN** any path is checked for containment
- **THEN** the outcome SHALL be identical to containment without the grant check

#### Scenario: Granted directory admits its subtree

- **GIVEN** `/a/b` is granted
- **WHEN** a path under `/a/b` is checked
- **THEN** it SHALL be allowed

#### Scenario: A granted subdirectory does NOT admit its repository

- **GIVEN** `/repo/sub` is granted and `/repo` is a git repository whose checkout root is `/repo`
- **WHEN** `/repo/other/secret.txt` is checked, outside every derived anchor
- **THEN** it SHALL be refused — the grant SHALL NOT widen to the checkout root

#### Scenario: A granted directory does not admit its parent

- **GIVEN** `/a/b` is granted
- **WHEN** `/a/sibling` is checked
- **THEN** it SHALL be refused

#### Scenario: Retargeting the granted directory does not move the grant

- **GIVEN** `/a/b` was granted and its stored subject is `/a/b`
- **WHEN** `/a/b` is replaced by a symlink to `/etc` and a read of `/a/b/passwd` is checked
- **THEN** it SHALL be refused — the check SHALL NOT re-resolve the stored subject

#### Scenario: An empty grant set costs nothing

- **GIVEN** no grant is in effect
- **WHEN** a containment check misses every pre-existing layer
- **THEN** the grant layer SHALL perform no filesystem syscall before refusing

#### Scenario: A symlink escaping a granted directory is refused

- **GIVEN** `/a/b` is granted and contains a symlink whose real target is `/elsewhere/secret`
- **WHEN** a read resolves through that symlink
- **THEN** it SHALL be refused — the grant check SHALL compare real paths, not lexical ones

#### Scenario: A symlink within a granted directory is allowed

- **GIVEN** `/a/b` is granted and contains a symlink whose real target is also under `/a/b`
- **WHEN** a read resolves through that symlink
- **THEN** it SHALL be allowed

#### Scenario: The existing containment predicate is unchanged

- **WHEN** the grant feature is present but the store is empty
- **THEN** every pre-existing file-read-containment behaviour SHALL be unchanged, including the bound-checkout-root widening of derived anchors

### Requirement: The grant store is bounded at 200 entries

The grant store SHALL hold at most 200 entries **per scope**. When recording a grant would exceed that bound, the oldest entry by grant time **within the same scope** SHALL be evicted first. The bound exists because every containment miss scans the store linearly with a `realpath` per entry, so an unbounded store is an unbounded cold-path cost.

Eviction SHALL NOT cross scopes: an in-memory session grant SHALL NOT cause a persisted project grant to be removed from disk.

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

### Requirement: A failed grant write does not record a grant

When persisting a grant fails, the system SHALL NOT treat the subject as granted. The denial SHALL be raised again on the next matching request, following the existing trust-on-first-use precedent. The failure SHALL be logged server-side **and** reported in the grant endpoint's own response, so the surface that requested the grant can state that it did not take effect — a server-side log alone is invisible to an operator working over a tunnel. The read request that triggered the denial SHALL NOT be failed differently because of the write error, and the admitted set SHALL NOT widen.

The store write SHALL be atomic (write to a temporary file, then rename). A partially written store would be read back as malformed and, per the degrade-to-empty rule above, would silently discard every persisted grant.

#### Scenario: Write failure leaves the subject ungranted

- **GIVEN** the grant store cannot be written (for example `EACCES`)
- **WHEN** an operator grants `/a/b`
- **THEN** a subsequent read under `/a/b` SHALL be refused
- **AND** the failure SHALL be recorded in the server log
- **AND** the grant response SHALL report that the grant was not persisted
- **AND** no unhandled rejection or HTTP 500 SHALL result

#### Scenario: An interrupted write does not corrupt the store

- **GIVEN** a store holding persisted grants
- **WHEN** the process is interrupted during a grant write
- **THEN** the store SHALL read back as either its previous contents or the fully written new contents, never as a truncated file

### Requirement: The grant check verifies the opened handle

A read admitted by the grant layer at a **byte-serving site** (`GET /api/file` read, `raw`, `render`, and the office/EML gates) SHALL be verified against the **opened file handle**, not against a path resolved a second time after the check.

This requirement SHALL NOT apply to sites that never open a file: the tree listing (which admits a directory and enumerates it), the existence probe, the file-mention resolver, and the grep filter. Those sites keep path-based grant checking and carry the same window layer 2 carries today. Applying the rule to them would break directory admission outright. This closes the window in which a symlink is swapped between the containment check and the open.

Verification SHALL be by file identity, not by recovering a path from the handle — no portable API maps a descriptor back to a path. The sequence SHALL be:

1. `lstat` the verified real path and refuse anything that is not a regular file **before** opening it. Opening a FIFO blocks, which would hold the request open — forbidden by this change's non-goals.
2. Open the file.
3. `fstat` the descriptor and compare device and inode against the pre-open `lstat`; on mismatch, close the handle and refuse.
4. Serve from the verified descriptor, never by re-opening the path.

This requirement applies to the grant layer only. The pre-existing derived-anchor layers carry the same window today; closing it there is out of scope for this change, which SHALL NOT widen that window. On platforms where device/inode identity is weaker, the check SHALL degrade to the pre-existing window and SHALL NOT be worse than current behaviour.

#### Scenario: A path swapped between check and open is refused

- **GIVEN** `/a/b` is granted
- **WHEN** a read under `/a/b` passes the grant check and the path is replaced with a symlink to `/etc` before the open completes
- **THEN** the read SHALL be refused rather than returning the substituted target's contents

#### Scenario: A non-regular file is refused before it is opened

- **GIVEN** `/a/b` is granted and contains a FIFO
- **WHEN** a read of that FIFO is admitted by the grant layer
- **THEN** it SHALL be refused without opening it, and the request SHALL NOT block

#### Scenario: An unswapped read is unaffected

- **GIVEN** `/a/b` is granted and nothing changes during the request
- **WHEN** a path under `/a/b` is read
- **THEN** it SHALL be allowed, and the handle verification SHALL NOT alter the response

### Requirement: A grant names the subject a recorded denial named, or one of its offered ancestors

A grant request SHALL reference a recorded denial by its identifier, and the granted subject SHALL be either the subject that denial named or one of the **offered ancestors** of that subject as defined by the requirement below. An arbitrary directory SHALL NOT be grantable by supplying it directly to the grant endpoint. An expired or unrecognised denial identifier SHALL be refused.

The following SHALL be refused as grant subjects regardless of the denial that named them: the filesystem root, the user's home directory, `~/.ssh`, `~/.pi`, and the platform system directories (`/etc`, `/usr`, `/var`, `/Library` and their platform equivalents). Comparison SHALL be against **real paths**, because a system directory may be reached through a symlink (`/etc` resolves to `/private/etc` on macOS) and a home directory may itself be a symlink.

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

### Requirement: Multiply-linked content is a stated limitation, not a silent one

Resolving a real path does not resolve a hard link: a second link to a file has
its own path and that path is where resolution stops. A containment rule
expressed over paths therefore cannot, by itself, prevent content that also lives
under a forbidden directory from being reachable through a link inside an
admitted subtree.

This SHALL be recorded as a limitation of the path model rather than left to be
discovered. The system SHALL NOT claim that path containment alone proves the
content was never reachable from a forbidden location.

The limitation is bounded by what creating such a link requires: permission to
traverse the forbidden directory, which for the directories on the list means
acting as the owning user. An actor that can already act as that user does not
need this system to read those files. The case this does **not** cover — a
constrained or sandboxed process running as the same user — is the same residual
recorded against capability issuance, and SHALL be assessed with it rather than
separately.

#### Scenario: The limitation is documented, not implied

- **WHEN** the containment model is described to operators or implementers
- **THEN** it SHALL state that a hard link to content under a forbidden directory is not detected by path containment

### Requirement: A denial offers a bounded ladder of ancestor subjects

Without this, an operator working across a directory tree is denied — and asked —
once per sibling directory. That volume is itself a hazard: repeated prompting
habituates the persistent answer, which is the outcome the grant model exists to
make deliberate.

For each recorded denial, the system SHALL compute an **offered-ancestor set**
and carry it in the denial body alongside the named subject, so a remedy surface
can offer a wider grant without inventing one.

The set SHALL be derived as follows:

1. Start from the **real path** of the named subject. Candidates are that
   subject and its proper ancestors. Candidates SHALL NOT be derived from the
   lexical path: a lexical ancestor of a symlinked path names a directory the
   operator never saw.
2. Truncate the ladder at the nearest enclosing **boundary**: the git checkout
   root containing the subject when there is one — **inclusive**, that root may
   be offered — otherwise the user's home directory or the filesystem mount
   point, **exclusive**, neither may be offered.
3. Remove every candidate refused by the forbidden-subject rule above.

The forbidden-subject rule SHALL apply to an ancestor exactly as to a named
subject: no ladder SHALL ever offer the filesystem root, the home directory,
`~/.ssh`, `~/.pi`, or a platform system directory, regardless of how the ladder
was computed.

**The boundary SHALL be defined in every case, not only the common one.** An
ambiguous boundary makes the offered set non-deterministic, and the offered set
is the only thing standing between a verdict and an arbitrary directory:

- **Nested checkouts and submodules** — the boundary SHALL be the **nearest**
  enclosing checkout root, not the outermost. A submodule is a narrower blast
  radius than its superproject, and the ladder's purpose is the narrowest
  sufficient widening.
- **Linked worktrees** — a checkout root SHALL be recognised whether its marker
  is a directory or a file.
- **Symlinked checkouts** — the checkout root SHALL be detected on the **real**
  path, the same path the candidates are derived from. Detecting it on the
  lexical path can yield a root that is not an ancestor of any candidate.
- **Mount points, bind mounts, and firmlinks** — where a platform presents a
  user's data on a different device from the filesystem root, the device boundary
  SHALL NOT be used to justify offering a directory the home-directory rule would
  refuse. Where the two disagree, the **more restrictive** boundary SHALL win.
- **No home directory** — where no home directory is resolvable, the absence
  SHALL NOT remove the boundary. The ladder SHALL truncate at the mount point,
  and the forbidden-subject rule SHALL still apply to every rung.
- **The subject is itself the boundary** — where the subject **is** the checkout
  root, the ladder SHALL contain exactly that subject. Where the subject is an
  exclusive boundary, the ladder SHALL be empty.

**The forbidden-subject rule SHALL be a real-path subtree relation in both
directions.** A candidate SHALL be refused when, comparing real paths, it **is**
a forbidden directory, lies **inside** one, or **contains** one. An equality test
is insufficient in both directions: a candidate inside a forbidden directory
admits that directory's contents, and a candidate containing one admits the
forbidden directory itself. This SHALL hold for named subjects and ladder rungs
alike.

**Path comparison SHALL be performed on a form the filesystem itself would treat
as identical**, not on the byte string the caller supplied. Resolving a real path
preserves the spelling it was given, so a byte comparison is not a containment
decision:

- On a **case-insensitive** filesystem, comparison SHALL be case-insensitive.
  `~/.SSH` and `~/.ssh` name one directory there, and a byte comparison admits
  one while refusing the other.
- Where the filesystem normalises **Unicode**, comparison SHALL apply the same
  normalisation before comparing.
- Comparison SHALL be **component-wise**, never string-prefix. A string prefix
  test treats `/repo-secrets` as inside `/repo`.
- Case- and normalisation-sensitivity SHALL be determined from the filesystem
  being compared on, not assumed from the host platform — a case-sensitive volume
  can be mounted on a case-insensitive system and the reverse.

**Where a path alone is ambiguous, the decision SHALL be made on identity.** A
resolved path is a name for content, not the content itself; two names may denote
one file. Where the implementation can compare the identity of the object it
actually opened against the identity of the subtree it admitted, it SHALL do so
rather than re-deriving a decision from the path string a second time.

#### Scenario: Case-insensitive spelling does not evade the rule

- **GIVEN** a case-insensitive filesystem
- **WHEN** a candidate names a forbidden directory in a different case
- **THEN** it SHALL be refused

#### Scenario: A sibling sharing a name prefix is not treated as contained

- **GIVEN** a granted subtree
- **WHEN** a path shares its leading characters but not its path components
- **THEN** it SHALL NOT be treated as inside that subtree

#### Scenario: A subject that cannot be resolved is refused

- **WHEN** the real path of a candidate cannot be resolved
- **THEN** it SHALL be refused rather than compared on its unresolved form

#### Scenario: A descendant of a forbidden directory is refused

- **GIVEN** a denial whose containing directory lies inside a forbidden directory
- **WHEN** the forbidden-subject rule is applied
- **THEN** it SHALL be refused, and SHALL NOT be offered as a subject or a rung

#### Scenario: An ancestor containing a forbidden directory is not offered

- **GIVEN** a candidate rung that contains a forbidden directory beneath it
- **WHEN** the ladder is computed
- **THEN** that rung SHALL NOT be offered

#### Scenario: The nearest checkout root bounds a nested checkout

- **GIVEN** a subject inside a checkout that is itself inside another checkout
- **WHEN** the ladder is computed
- **THEN** it SHALL truncate at the nearer root

#### Scenario: A symlinked checkout is bounded on its real path

- **GIVEN** a subject reached through a symlinked checkout directory
- **WHEN** the ladder is computed
- **THEN** the checkout root SHALL be detected on the real path

#### Scenario: A missing home directory does not remove the boundary

- **GIVEN** an environment with no resolvable home directory
- **WHEN** the ladder is computed for a subject outside any checkout
- **THEN** it SHALL still be bounded, and every rung SHALL still pass the forbidden-subject rule

#### Scenario: A subject that is the checkout root offers only itself

- **GIVEN** a denial naming a directory that is itself a checkout root
- **WHEN** the ladder is computed
- **THEN** it SHALL contain exactly that subject

A grant for an offered ancestor SHALL be recorded exactly like any other grant —
same subtree semantics, same `realpath` storage, same scope, same revocation —
and SHALL record that the granted subject was widened from the denied one.

#### Scenario: A ladder stops below the home directory

- **GIVEN** a denial naming `/Users/u/Documents/contracts/2026-q1` outside any git checkout
- **WHEN** the offered-ancestor set is computed
- **THEN** it SHALL contain `/Users/u/Documents/contracts` and `/Users/u/Documents`
- **AND** it SHALL NOT contain `/Users/u` or `/`

#### Scenario: A ladder stops at the checkout root

- **GIVEN** a denial naming `/Users/u/Project/repo/packages/x` inside a checkout rooted at `/Users/u/Project/repo`
- **WHEN** the offered-ancestor set is computed
- **THEN** its highest entry SHALL be `/Users/u/Project/repo`
- **AND** it SHALL NOT contain `/Users/u/Project`

#### Scenario: Ancestors are derived from the real path

- **GIVEN** a denial whose named subject `/link/sub` resolves to `/real/target/sub`
- **WHEN** the offered-ancestor set is computed
- **THEN** its entries SHALL be ancestors of `/real/target/sub`
- **AND** `/link` SHALL NOT be offered

#### Scenario: A forbidden directory is never offered as an ancestor

- **GIVEN** a denial whose ladder would otherwise reach `/etc` or the home directory
- **WHEN** the offered-ancestor set is computed
- **THEN** those entries SHALL be absent
- **AND** a grant request naming one SHALL be refused even if the caller supplies it

#### Scenario: An ancestor grant admits the whole ancestor subtree

- **GIVEN** a denial naming `/a/b/c` and an operator granting the offered ancestor `/a/b`
- **WHEN** a path under `/a/b` is later read
- **THEN** it SHALL be admitted
- **AND** the Access surface SHALL show the granted subject as `/a/b`, recorded as widened from `/a/b/c`

#### Scenario: A denial with no eligible ancestors offers none

- **GIVEN** a denial whose named subject's parent is the home directory
- **WHEN** the offered-ancestor set is computed
- **THEN** it SHALL be empty
- **AND** only the named subject SHALL be grantable

### Requirement: Filesystem denials are recorded in a bounded path-denial registry

The system SHALL record every containment denial that names a grantable subject in a registry keyed by that subject. Each entry SHALL carry an opaque identifier, the subject, the refusing site, the originating session, and a timestamp. The denial response SHALL carry the identifier and the subject so a remedy surface can reference them.

This registry is distinct from the IP-keyed network denial ledger, which carries no path. Entries SHALL expire after a bounded interval and the registry SHALL be capped with oldest-first eviction. The registry SHALL be written only by the denial path; no inbound request SHALL be able to create an entry.

#### Scenario: A containment denial is recorded with its subject

- **WHEN** a read is refused by containment at a site that emits a response body
- **THEN** a registry entry SHALL exist carrying the grantable subject and an identifier
- **AND** the denial body SHALL carry that identifier and subject alongside its unchanged `error` string

#### Scenario: Entries expire and are capped

- **GIVEN** the registry is at its cap
- **WHEN** a further denial is recorded
- **THEN** the oldest entry SHALL be evicted and the registry SHALL stay at its cap

#### Scenario: No inbound path creates a registry entry

- **WHEN** the full route inventory is scanned
- **THEN** no endpoint SHALL exist that creates a denial-registry entry

### Requirement: Session-scoped grants are process-scoped and fully described

`"session"` scope SHALL mean the lifetime of the server process, not the lifetime of the pi session whose denial produced the grant. Every grant SHALL be process-global: it admits paths for every session and every connected client until revoked or until the process restarts.

A session-scoped grant SHALL carry the same four fields as a persisted one — subject, scope, grant time, and origin — and SHALL be listable and revocable exactly like a persisted grant. It SHALL differ only in never being written to disk. The origin field SHALL record which session's denial produced the grant, since the grant itself is not scoped to it.

#### Scenario: A session grant is visible to another session

- **GIVEN** a session-scoped grant created from one session's denial
- **WHEN** a different session requests a path under that subject
- **THEN** it SHALL be admitted

#### Scenario: A session grant is fully described in the review surface

- **WHEN** a session-scoped grant is listed
- **THEN** it SHALL show subject, scope, grant time, and origin, and SHALL offer revoke

### Requirement: Grants are revocable and revocation takes effect immediately

The system SHALL support removing a grant. After revocation, paths that were allowed only by that grant SHALL be refused again without requiring a restart.

#### Scenario: Revoked anchor stops admitting

- **GIVEN** `/a/b` was granted and a read under it succeeds
- **WHEN** the grant is revoked
- **THEN** a subsequent read under `/a/b` SHALL be refused
