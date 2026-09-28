## Purpose

Holds denied access requests open — or records them for later retry — while the
operator is asked for a verdict, across every access plane. It is the
server-side half of asking at the moment of denial: one bounded registry that
correlates a denial, a prompt, and the first reply.

## ADDED Requirements

### Requirement: A pending access request is recorded per plane and subject

The server SHALL maintain a registry of pending access requests. Each entry
SHALL be keyed by the pair of its **plane** and its **normalised subject**, never
by the subject alone. Each plane SHALL own the normalisation of its own subjects,
and a filesystem subject SHALL be normalised to the same canonical form the
persisted grant store uses, so a verdict and the grant it produces cannot refer
to different things.

#### Scenario: Two planes with the same subject string do not collide

- **GIVEN** a pending request on one plane whose subject string equals a subject string on another plane
- **WHEN** a verdict settles one of them
- **THEN** the other SHALL remain pending

#### Scenario: A repeat denial coalesces

- **WHEN** a denial arrives for a plane and subject that already has a pending entry
- **THEN** it SHALL join the existing entry rather than creating a second one
- **AND** at most one dialog SHALL be outstanding for that plane and subject

#### Scenario: An unknown-cwd denial does not join a path-grant entry

- **GIVEN** a pending path-grant request for a directory
- **WHEN** an unknown-working-directory denial arrives naming the same directory
- **THEN** it SHALL be recorded as a separate entry, so the verdict applies the correct remedy

### Requirement: Entries are bounded, expiring, and settled at most once

The registry SHALL hold at most **64** entries and every entry SHALL expire
**120 s** after it is recorded. A held request SHALL NOT be suspended longer
than that same 120 s — the hold ceiling and the entry TTL are deliberately one
number, so they cannot disagree — and on elapse the requester SHALL receive the
denial it would have received with no prompt at all.

The registry SHALL be bounded in size and every entry SHALL expire after a
bounded lifetime. An entry SHALL be settled at most once: the first well-formed
verdict SHALL settle it, and later verdicts for that entry SHALL be ignored.

When the registry is at capacity, a new denial SHALL still be recorded as a
denial but SHALL NOT raise a dialog.

#### Scenario: Expiry denies

- **WHEN** a pending entry reaches its lifetime without a verdict
- **THEN** it SHALL be removed
- **AND** any request suspended on it SHALL receive its existing denial

#### Scenario: A second verdict is ignored

- **WHEN** a verdict arrives for an entry that is already settled
- **THEN** it SHALL have no effect on access
- **AND** it SHALL be counted for diagnostics

#### Scenario: Malformed verdicts are ignored

- **WHEN** a verdict arrives that does not name a known pending entry, or whose shape is invalid
- **THEN** it SHALL be discarded without settling anything

#### Scenario: Capacity exhaustion does not prompt

- **WHEN** the registry is at capacity and a new prompt-eligible denial arrives
- **THEN** no dialog SHALL be raised
- **AND** the request SHALL receive its existing denial

### Requirement: A suspended request survives the server's connection timeout and is released on abort

A suspended request SHALL remain open past the server's default connection
timeout for as long as its entry is pending, and the connection's original
timeout behaviour SHALL be restored once the response completes. If the client
disconnects or aborts while suspended, the entry SHALL be released and no
resource SHALL remain reserved for it.

#### Scenario: A hold outlives the default connection timeout

- **WHEN** a request is suspended for longer than the server's default connection timeout
- **THEN** it SHALL NOT be terminated by that timeout
- **AND** on completion the connection SHALL be returned to its prior timeout behaviour

#### Scenario: Client abort releases the entry

- **WHEN** a client aborts a suspended request
- **THEN** the pending entry SHALL be released
- **AND** no dialog SHALL remain outstanding for it

### Requirement: An allow verdict is applied by the plane that raised it

An `allow-once` verdict SHALL permit only the suspended request that raised it.
An `allow-always` verdict SHALL additionally persist a grant by writing the grant
store belonging to that plane, and SHALL NOT write any other store. A `deny`
verdict SHALL persist nothing.

A verdict SHALL NOT widen access beyond the subject it names. On a plane that
offers an ancestor ladder, the verdict MAY name an offered ancestor instead of
the denied subject; it SHALL be refused if it names anything the denial did not
offer.

#### Scenario: Allow once does not persist

- **WHEN** an operator answers `allow-once`
- **THEN** the suspended request SHALL proceed
- **AND** a later equivalent request SHALL be denied again

#### Scenario: Allow always writes exactly one store

- **WHEN** an operator answers `allow-always` on a given plane
- **THEN** a grant SHALL be persisted in that plane's store only
- **AND** it SHALL be listed and revocable in the unified Access surface

#### Scenario: A verdict may name an offered ancestor

- **GIVEN** a denial naming `/a/b/c` whose offered ancestors include `/a/b`
- **WHEN** the operator answers `allow-always` selecting `/a/b`
- **THEN** the grant SHALL be persisted for `/a/b`
- **AND** it SHALL record that it was widened from `/a/b/c`

#### Scenario: A verdict naming an unoffered directory is refused

- **WHEN** a verdict names a directory that was not the denied subject and not one of its offered ancestors
- **THEN** it SHALL be refused and no grant SHALL be created

#### Scenario: Deny persists nothing

- **WHEN** an operator answers `deny`
- **THEN** no grant SHALL be created
- **AND** the request SHALL receive its existing denial

#### Scenario: A revoke while pending does not resurrect access

- **GIVEN** a grant is revoked while a request is suspended on the same subject
- **WHEN** the pending request settles
- **THEN** access SHALL reflect the revocation

### Requirement: A resumed request re-runs the guard it was denied by

A verdict SHALL authorise a **re-evaluation**, never a resumption that skips the
check. When a suspended request is released, the guard that denied it SHALL run
again in full — including real-path and symlink resolution and the
forbidden-subject rule — against the filesystem as it is at release time.

A verdict captured at one moment and applied at another SHALL NOT be treated as
evidence that the subject still means what it meant when the operator answered.

#### Scenario: A swapped symlink is not admitted by a stale verdict

- **GIVEN** a suspended request whose subject was replaced by a link to a different location after the operator answered
- **WHEN** the request is released
- **THEN** the guard SHALL re-run and SHALL deny it

#### Scenario: A revoked grant is not resurrected by a pending verdict

- **GIVEN** a verdict recorded for a subject whose grant is revoked before release
- **WHEN** the request is released
- **THEN** the re-run guard SHALL reflect the revocation

#### Scenario: An allow-once release still runs every layer

- **WHEN** an allow-once verdict releases a request
- **THEN** no containment layer SHALL be skipped, reordered, or widened

### Requirement: Repeat prompting is rate limited

After an entry settles, further denials for the same plane and subject SHALL be
suppressed from prompting for a backoff window of **120 s**. The server SHALL
additionally hold to a ceiling of **5 prompts per plane per minute**, at most
**2 concurrent dialogs** across all planes, and a per-channel share of at most
**20%** of registry capacity (12 of 64 entries). Exhausting any of these SHALL
degrade to record-only, never to an automatic allow. The server SHALL additionally
limit prompts per plane and cap the number of dialogs outstanding at once.
Exhausting any limit SHALL degrade to recording the denial without prompting.

#### Scenario: A polling client does not re-prompt

- **GIVEN** a denial was answered `deny`
- **WHEN** the same client retries repeatedly within the backoff window
- **THEN** no further dialog SHALL be raised for that plane and subject

#### Scenario: A flood degrades to record-only

- **WHEN** denials arrive faster than the configured limits allow
- **THEN** the excess SHALL be recorded without prompting
- **AND** no denial SHALL be auto-allowed as a result

### Requirement: Prompt volume is bounded per requester, not only globally

The prompt-volume controls SHALL include a **per-channel dimension**: a bound on
how much of the registry's capacity and prompting budget any single prompt
capability, connection, or remote source may consume.

Without it, one requester emitting denials against distinct subjects exhausts a
shared bound and forces every other plane into its record-only state — starving
prompts the operator would have wanted, without a single grant being created.

Exhaustion caused by one requester SHALL NOT degrade prompting for unrelated
planes or unrelated requesters.

Concretely, a single channel SHALL hold at most 12 registry entries and at most
1 open dialog; a channel on a deferred plane SHALL additionally be limited to 1
prompt per plane per minute. A channel past its entry share SHALL NOT be given a
registry entry, so it cannot consume capacity other requesters need.

A remote requester (one identified by source address rather than an operator
channel) SHALL be keyed by its allocation — an IPv4 /24 or an IPv6 /64, with
IPv4-mapped IPv6 treated as IPv4 — so address rotation within one allocation is
one requester. Entries on deferred planes, taken together, SHALL NOT exceed 16
of the 64; a deferred denial past that share SHALL NOT be given a registry
entry, and the refusal SHALL be recorded distinguishably from the per-channel
share.

#### Scenario: Rotating remote sources cannot starve held prompts

- **GIVEN** a remote peer emitting network denials from many addresses
- **WHEN** its addresses share one allocation, or span many allocations
- **THEN** it SHALL be bounded by the per-channel share, or by the deferred share
- **AND** a held denial from the operator's own browser SHALL still get an entry

#### Scenario: One requester cannot exhaust the shared budget

- **GIVEN** a single requester emitting denials against many distinct subjects
- **WHEN** its per-channel bound is reached
- **THEN** further denials from it SHALL be recorded without prompting
- **AND** denials from other requesters and other planes SHALL still prompt

#### Scenario: Starvation is diagnosable

- **WHEN** prompting is suppressed by a per-channel bound
- **THEN** it SHALL be recorded as such, distinguishably from a global bound

### Requirement: Every transition is diagnosable

The server SHALL record each pending-request transition — recorded, prompted,
degraded (with the reason), settled (with the verdict), expired, aborted, and
rate-limited — together with the plane and the normalised subject. A verdict that
produced a grant SHALL record which store was written.

#### Scenario: A degraded hold is distinguishable from an ineligible denial

- **WHEN** a denial that could have suspended is answered immediately instead
- **THEN** the recorded reason SHALL name the condition that caused the degradation
