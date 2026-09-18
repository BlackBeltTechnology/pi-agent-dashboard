## ADDED Requirements

### Requirement: A session declared disposable is archived when it ends

A plugin spawning a session SHALL be able to declare that session disposable
once it ends. The declaration SHALL be part of the generic spawn lifecycle
declaration the host already carries, so that no plugin-specific value appears
in the archive rules, and SHALL be distinct from the ephemeral lifecycle marker
that governs idle reaping and session acquisition — a session may be ephemeral
without being disposable on end.

The dashboard config SHALL expose `sessionList.archiveServiceSessionsOnEnd`
(boolean, default `true`), readable and writable through the existing config
endpoints and effective without a server restart. While enabled, a session
declared disposable SHALL be archived shortly after it reaches the ended state,
following the same transition as a manual archive.

`archiveAfterDays` SHALL NOT gate this rule: a deployment that has disabled
age-based archiving SHALL still archive disposable sessions on end while this
setting is enabled.

#### Scenario: Declared session is archived on end

- **WHEN** a session declared disposable ends
- **THEN** it SHALL be archived and an archived broadcast SHALL be emitted

#### Scenario: Undeclared session is untouched

- **WHEN** a session that carries no disposability declaration ends
- **THEN** it SHALL NOT be archived by this rule and SHALL remain subject to
  the age threshold only

#### Scenario: Ephemeral alone does not trigger the archive

- **WHEN** a session carrying the ephemeral lifecycle marker but no
  disposability declaration ends
- **THEN** it SHALL NOT be archived by this rule, and SHALL remain available to
  any acquisition path specified to resume an ended ephemeral session

#### Scenario: Setting disabled

- **WHEN** the setting is `false` and a session declared disposable ends
- **THEN** it SHALL NOT be archived on end and SHALL remain subject to the age
  threshold only

#### Scenario: Independent of the age threshold

- **WHEN** `archiveAfterDays` is `0` and a session declared disposable ends
  with the setting enabled
- **THEN** it SHALL still be archived

### Requirement: The on-end archive is deferred and re-validated

The archive SHALL NOT be performed synchronously within the ended transition.
It SHALL be deferred by a fixed grace window measured from that transition, so
that handlers which read an ended session — such as a plugin capturing a run's
result — complete before the session leaves the live set.

At the end of the grace window the system SHALL re-validate eligibility and
SHALL skip the archive if the session is no longer resident, is no longer
ended, is no longer declared disposable, is a cold-start recovery candidate, is
currently viewed by a connected browser, or the setting has since been
disabled.

Scheduling SHALL be idempotent per session: an ended session whose terminal
state is re-notified — for example when it learns a more precise close reason —
SHALL NOT be scheduled or archived twice.

A pending deferred archive SHALL NOT outlive the server process.

#### Scenario: Result capture is not raced

- **WHEN** a plugin's end-of-session handler reads the ended session during the
  grace window
- **THEN** the session SHALL still be resident for that read, and the archive
  SHALL happen afterwards

#### Scenario: Re-notified terminal state does not double-archive

- **WHEN** an already-ended disposable session is re-notified as ended before
  its grace window elapses
- **THEN** exactly one archive SHALL be performed

#### Scenario: Viewed session is deferred

- **WHEN** the grace window elapses for an ended disposable session currently
  open in a connected browser
- **THEN** it SHALL NOT be archived at that moment, and SHALL be archived later
  once it is no longer viewed

#### Scenario: Recovery candidate is not archived

- **WHEN** the grace window elapses for a session that is a cold-start recovery
  candidate
- **THEN** it SHALL NOT be archived

#### Scenario: Pending archives do not outlive the server

- **WHEN** the server shuts down while a grace window is pending
- **THEN** the pending archive SHALL be cancelled and SHALL NOT fire after
  shutdown

### Requirement: Boot scan reclaims service sessions that predate the declaration

During the boot scan, a stored session record that is not a cold-start recovery
candidate, carries no archive state at all, and carries the ephemeral lifecycle
marker SHALL be archived at scan time regardless of its age while
`archiveServiceSessionsOnEnd` is enabled, using the same scan-time archive path
as the age rule: record rewritten with the archive state, added to the archive
index, never restored into the live set, and no removal broadcast emitted.

The recovery-candidate test SHALL be used rather than the persisted status,
because a clean server stop leaves a non-ended status behind and a status test
would skip exactly the sessions that ended while the server was down.

A record carrying an explicit not-archived state SHALL be treated as carrying
archive state and SHALL NOT be archived by this rule, so that a session the
user deliberately restored is not re-archived on the next boot.

#### Scenario: Pre-existing service sessions are reclaimed

- **WHEN** the server boots and records exist for ended ephemeral sessions from
  several weeks ago that are younger than `archiveAfterDays`
- **THEN** they SHALL be archived at scan time and SHALL NOT appear in the
  first sessions snapshot

#### Scenario: Ended while the server was down

- **WHEN** a disposable session's record still carries a non-ended status
  because the server stopped before its grace window elapsed, and it is not a
  recovery candidate
- **THEN** it SHALL be archived at scan time

#### Scenario: Deliberately restored session is not re-archived

- **WHEN** the server boots and a record carries an explicit not-archived state
  from a previous restore
- **THEN** it SHALL NOT be archived by this rule

#### Scenario: Recovery candidate is skipped

- **WHEN** the server boots and an ephemeral session's record marks it a
  cold-start recovery candidate
- **THEN** it SHALL NOT be archived by this rule

#### Scenario: Setting disabled at boot

- **WHEN** the server boots with `archiveServiceSessionsOnEnd` set to `false`
- **THEN** no record SHALL be archived by this rule

### Requirement: Automatic service archive is attributable

An archive performed by this rule SHALL be logged with a reason distinct from
the age-sweep reason, so an unexpected eviction is attributable from the server
log alone.

#### Scenario: Reason is logged

- **WHEN** a disposable session is archived on end
- **THEN** the server log SHALL contain a line naming the session and a reason
  distinct from the age-sweep reason
