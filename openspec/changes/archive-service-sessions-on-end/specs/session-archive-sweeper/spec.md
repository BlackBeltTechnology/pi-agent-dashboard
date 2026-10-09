## MODIFIED Requirements

### Requirement: Configurable archive threshold and interval

The dashboard config SHALL expose `sessionList.archiveAfterDays` (integer ≥ 0, default `30`) and `sessionList.archiveSweepIntervalMinutes` (integer ≥ 1, default `60`). A value of `0` for `archiveAfterDays` SHALL disable age-based automatic archiving; it SHALL NOT disable the on-end archive of sessions declared disposable, which is governed solely by `sessionList.archiveServiceSessionsOnEnd`. Both values SHALL be readable and writable through the existing config endpoints and SHALL take effect on the next sweep without a server restart.

#### Scenario: Defaults when absent
- **WHEN** the config file has no `sessionList` section
- **THEN** the effective values SHALL be `archiveAfterDays = 30` and `archiveSweepIntervalMinutes = 60`

#### Scenario: Zero disables auto-archive
- **WHEN** `archiveAfterDays` is `0`
- **THEN** the sweeper SHALL archive no session on account of its age, regardless of session age

#### Scenario: Config change applies live
- **WHEN** `archiveAfterDays` is changed from 30 to 7 via the config write endpoint
- **THEN** the next sweep SHALL use 7 days without a restart

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
ended, is no longer declared disposable, is marked live, has been restored
from the archive since the archive was scheduled, or the setting has since been
disabled. A session archived or restored from the archive by any other path
while the deferral is pending SHALL NOT be archived by that deferral. If the session is currently viewed by a
connected browser, the system SHALL instead defer it by another grace window
and re-validate then, so that it is archived no later than one grace window
after the last viewer leaves.

The rule SHALL NOT be retroactive: only the ended transition schedules the
archive. A session that ended while the setting was disabled SHALL NOT be
archived by this rule when the setting is later enabled.

Scheduling SHALL be idempotent per session: an ended session whose terminal
state is re-notified — for example when it learns a more precise close reason —
SHALL NOT be scheduled or archived twice. A session restored from the archive
SHALL NOT be scheduled by a re-notification of the end that preceded its
restore; only an end after the restore schedules it again.

When a session has been restored since scheduling and is also viewed at the end
of the grace window, the restore SHALL take precedence: the deferral is dropped,
not re-armed.

A pending deferred archive SHALL NOT outlive the server process, and no new
deferral SHALL be scheduled once server shutdown has begun.

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
- **THEN** it SHALL NOT be archived at that moment, and SHALL be archived no
  later than one grace window after the last viewer leaves

#### Scenario: Enabling the setting is not retroactive

- **WHEN** a disposable session ended while the setting was `false`, and the
  setting is then set to `true`
- **THEN** it SHALL NOT be archived by the on-end rule

#### Scenario: Restore inside the grace window is respected

- **WHEN** a disposable session is archived manually and then restored from the
  archive before its grace window elapses
- **THEN** the pending archive SHALL NOT fire and the restored session SHALL
  remain resident

#### Scenario: Restored session re-notified as ended is not re-archived

- **WHEN** a disposable session restored from the archive learns a new close
  reason for its earlier end
- **THEN** it SHALL NOT be scheduled for archive and SHALL remain resident

#### Scenario: Restored and viewed at fire time

- **WHEN** a disposable session is archived and restored inside its grace
  window and is open in a connected browser when the window elapses
- **THEN** it SHALL NOT be archived and SHALL NOT be deferred again

#### Scenario: Live-marked session is not archived

- **WHEN** the grace window elapses for a session that is marked live
- **THEN** it SHALL NOT be archived

#### Scenario: Pending archives do not outlive the server

- **WHEN** the server shuts down while a grace window is pending
- **THEN** the pending archive SHALL be cancelled and SHALL NOT fire after
  shutdown

### Requirement: Boot scan reclaims disposable service sessions

During the boot scan, while `archiveServiceSessionsOnEnd` is enabled, a stored
session record that is not marked live and carries no archive state at all SHALL
be archived at scan time regardless of its age when either:

- it is declared disposable (every boot); or
- it carries the ephemeral lifecycle marker and is not declared disposable, and
  this is the first boot with the setting enabled since this requirement took
  effect (the legacy pass, which reclaims records written before the
  declaration existed and SHALL run at most once per installation).

Archiving SHALL use the same scan-time archive path as the age rule: record
rewritten with the archive state, added to the archive
index, never restored into the live set, and no removal broadcast emitted.

The live marker SHALL be used rather than the persisted status, because a
clean server stop leaves a non-ended status behind and a status test would skip
exactly the sessions that ended while the server was down. A record still marked
live SHALL NOT be archived by this rule, because a restart that leaves sessions
running marks them live and they may reattach.

This rule is separate from the on-end rule: a declared session that ended while
the setting was disabled MAY be archived by it at a later boot once the setting
is enabled.

A record carrying an explicit not-archived state SHALL be treated as carrying
archive state and SHALL NOT be archived by this rule, so that a session the
user deliberately restored is not re-archived on the next boot.

#### Scenario: Pre-existing service sessions are reclaimed

- **WHEN** the server boots and records exist for ended ephemeral sessions from
  several weeks ago that are younger than `archiveAfterDays`
- **THEN** they SHALL be archived at scan time and SHALL NOT appear in the
  first sessions snapshot

#### Scenario: Run left running across a restart is skipped

- **WHEN** the server boots and a disposable session's record is still marked
  live because a restart left it running
- **THEN** it SHALL NOT be archived by this rule

#### Scenario: Ended while the server was down

- **WHEN** a disposable session's record still carries a non-ended status
  because the server stopped before its grace window elapsed, and it is not
  marked live
- **THEN** it SHALL be archived at scan time

#### Scenario: Declared non-ephemeral session reclaimed after a stop

- **WHEN** the server boots and a record declared disposable, not ephemeral,
  not marked live, and without archive state exists
- **THEN** it SHALL be archived at scan time

#### Scenario: Legacy pass runs once

- **WHEN** the server boots a second time after a boot that ran the legacy pass,
  and an ephemeral, undeclared, unarchived, not-live record exists
- **THEN** it SHALL NOT be archived by this rule

#### Scenario: Legacy pass deferred while disabled

- **WHEN** the server boots with the setting `false`, and later boots with the
  setting `true`
- **THEN** the legacy pass SHALL run on the later boot

#### Scenario: Deliberately restored session is not re-archived

- **WHEN** the server boots and a record carries an explicit not-archived state
  from a previous restore
- **THEN** it SHALL NOT be archived by this rule

#### Scenario: Live-marked ephemeral record is skipped

- **WHEN** the server boots and an ephemeral session's record is marked live
- **THEN** it SHALL NOT be archived by this rule

#### Scenario: Setting disabled at boot

- **WHEN** the server boots with `archiveServiceSessionsOnEnd` set to `false`
- **THEN** no record SHALL be archived by this rule

### Requirement: Automatic service archive is attributable

An archive performed by the on-end rule or the boot backfill SHALL be logged
per session with a reason distinct from the age-sweep reason, so an unexpected
eviction is attributable from the server log alone.

#### Scenario: Reason is logged

- **WHEN** a disposable session is archived on end
- **THEN** the server log SHALL contain a line naming the session and a reason
  distinct from the age-sweep reason

#### Scenario: Backfill reason is logged per session

- **WHEN** the boot backfill archives a record
- **THEN** the server log SHALL contain a line naming that session and a reason
  distinct from the age-sweep reason
