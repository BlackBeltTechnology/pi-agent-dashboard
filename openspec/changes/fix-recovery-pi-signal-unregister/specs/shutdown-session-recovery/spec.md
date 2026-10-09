## MODIFIED Requirements

### Requirement: Intentional close SHALL clear the liveness marker with a reason

When a session is closed intentionally — manual close (`handleShutdown`), force-kill (`handleForceKill`), or ANY session unregister (explicit `session_unregister`, heartbeat expiry, run termination) — the server SHALL persist `{ live: false }` to the session's `.meta.json`. The unregister-path write SHALL be eager (atomic, not debounced): `unregister()` persists `status: "ended"` through the 1s-debounced save, and without an eager `live: false` a host death inside that window leaves `live: true` + a non-`ended` status on disk — the next cold start would offer (or in `auto` mode, silently respawn) a session that ended cleanly. Manual close and force-kill SHALL additionally persist `closedReason: "manual"`.

When the session ended because its bridge sent an explicit `session_unregister` (pi exiting gracefully — `/quit`, session switch, or an OS signal), the same eager end write SHALL also persist the session's `endedAt` and the `liveEpoch` of the server boot in which the session ENDED (not the epoch it was last activated under). Both values SHALL be durable on disk even when the debounced save never flushes. A session closed from the dashboard (Stop or force-kill) SHALL be marked `closedReason: "manual"` before pi is signalled, so a bridge unregister racing the close cannot record it as `unknown`. No other ending — manual close, force-kill, heartbeat or reconnect-grace expiry, history or placeholder cleanup, finalize-on-close, spawn failure, or RELOCATION to another dashboard instance — SHALL persist that `liveEpoch`, so none of them can qualify as a shutdown-window recovery candidate. Re-firing the end write for the same session within the same boot (e.g. a refined `closedReason`) SHALL NOT remove or alter evidence already written.

A clean server `stop()` SHALL NOT itself clear the per-session `live` markers of the sessions it tears down; it records its exit intent instead (see "Cold start SHALL classify interrupted sessions as recovery candidates").

The `closedReason` vocabulary is EXTENDED to cover involuntary endings (see
`session-death-attribution`). Values other than `"manual"` SHALL be persisted
through the same liveness-persistence path.

This extension SHALL NOT modify the recovery-candidate predicate.
`isRecoveryCandidate` tests `closedReason !== "manual"`, so newly added values
pass through it unchanged and an involuntarily-ended session remains a recovery
candidate — which is the correct outcome, since it is exactly the session a user
may want to reopen. Changing the predicate to special-case new values is
explicitly out of scope and would add regression surface for no benefit.

#### Scenario: Explicit unregister eagerly clears liveness

- **GIVEN** a running session with `live: true`
- **WHEN** the session unregisters cleanly (pi TUI quit sending `session_unregister`)
- **THEN** the session's `.meta.json` SHALL be updated to `live: false` immediately, without waiting for the debounced stats write
- **AND** SHALL NOT set `closedReason: "manual"`

#### Scenario: End write carries endedAt and the ending boot

- **GIVEN** a session last activated under boot `A` and still running under boot `B`
- **WHEN** its bridge sends `session_unregister` during boot `B`
- **THEN** the eager write SHALL persist `live: false`, the session's `endedAt`, and `liveEpoch = B`
- **AND** those fields SHALL be on disk even if the server exits before the debounced save flushes

#### Scenario: Non-bridge endings get no ending-boot epoch

- **GIVEN** a session that ends during boot `B` through heartbeat expiry, history cleanup (registered and unregistered in the same step), or a manual close
- **WHEN** the end write runs
- **THEN** its `.meta.json` SHALL be updated to `live: false`
- **AND** SHALL NOT carry a `liveEpoch`

#### Scenario: Dashboard Stop racing the bridge unregister stays manual

- **GIVEN** a running session the user stops from the dashboard
- **WHEN** pi's bridge sends `session_unregister` before the server's own unregister runs
- **THEN** the session SHALL end with `closedReason: "manual"`
- **AND** its `.meta.json` SHALL NOT carry a `liveEpoch`

#### Scenario: Relocated session gets no ending-boot epoch

- **GIVEN** a running session that is relocated to another dashboard instance
- **WHEN** the source server ends it
- **THEN** its `.meta.json` SHALL be updated to `live: false`
- **AND** SHALL NOT carry a `liveEpoch`

#### Scenario: Manual close stamps closedReason

- **GIVEN** a running session with `live: true`
- **WHEN** the user closes it (a `shutdown` / `force_kill` message handled by the server)
- **THEN** the session's `.meta.json` SHALL be updated to `live: false`
- **AND** SHALL contain `closedReason: "manual"`

#### Scenario: Clean server stop clears liveness without manual reason

- **GIVEN** running sessions with `live: true`
- **WHEN** the server performs a clean `stop()` (idle timer)
- **THEN** the boot record SHALL carry the stop's exit intent (the scenario name is historical: `stop()` no longer clears markers itself; a session's marker is cleared only by its own unregister)
- **AND** `stop()` itself SHALL NOT rewrite any session's `live` marker
- **AND** SHALL NOT set `closedReason: "manual"`

#### Scenario: An involuntary reason does not disqualify recovery

- **GIVEN** a session that ended with a non-`manual` involuntary reason
- **WHEN** the server classifies recovery candidates at cold start
- **THEN** the session SHALL be evaluated exactly as it is today
- **AND** the new reason SHALL NOT cause it to be excluded

### Requirement: Cold start SHALL classify interrupted sessions as recovery candidates

On server cold start, for each rediscovered session, the server SHALL classify it as a recovery
candidate WHEN its `.meta.json` carries `live: true` AND its persisted `status` is NOT `"ended"`
AND it does NOT carry `closedReason: "manual"` AND it is NOT an automation run session
(`kind: "automation"`) AND no process-carrier proves the session alive (keeper channel /
bridge-reattach channel) **AND the boot that owned the session did not record a
recovery-suppressing exit intent**.

Exit intent is resolved by matching the session's `liveEpoch` against the boot-record ring:

- `"restart"`, `"shutdown"` — recovery **suppressed**; the session SHALL NOT be a candidate.
- `"user-quit"`, `"idle"`, `"signal"`, `null`, or an unresolvable `liveEpoch` — recovery
  **allowed**; the remaining conjuncts (including process liveness) decide.

This closes the defect that made disk-marker absence ambiguous: `POST /api/restart` and
`POST /api/shutdown` terminate without clearing per-session markers, so a still-running session
was indistinguishable on disk from a crashed one. Recovery now depends on a **positive** record
of deliberate exit rather than on the absence of cleanup, and therefore does not depend on any
timing window for the restart path.

Because intent is recorded explicitly, a clean `stop()` SHALL NO LONGER clear the per-session
`live` markers of the sessions it tears down. Marker consumption on dismiss, liveness retract,
and offer broadcast is unchanged.

**Shutdown-window candidates.** A host shutdown signals pi and the server together; pi exits
gracefully first and its bridge sends `session_unregister`, so such a session reaches disk as
`live: false` before the server records its exit. The server SHALL therefore ALSO classify a
rediscovered session as a recovery candidate WHEN ALL of the following hold:

- its `.meta.json` does NOT carry `live: true`, and carries both a `liveEpoch` and an `endedAt`;
- its `closedReason` is `"unknown"`, and it does not declare `recover: false`;
- its `liveEpoch` resolves in the boot record (current entry or ring) to a boot that recorded
  exit intent `"signal"` or `"user-quit"`;
- the absolute difference between its `endedAt` and that boot's recorded exit time is at most
  60 seconds.

No other exit intent, and no unrecorded (`null`) intent, SHALL qualify a session through this
path. The persisted `status` SHALL NOT be consulted by this path (a fast exit can lose the
debounced `status: "ended"` write). A shutdown-window candidate SHALL be subject to the same
process-liveness retraction, grace window, offer, dismiss, auto-resume and
`reopenSessionsAfterShutdown = "off"` handling as any other candidate. The window is evaluated
on the session as persisted, before cold-start status normalization derives any `endedAt`. When a
session satisfies the window conditions, cold start SHALL durably consume its evidence (remove
the persisted `liveEpoch`) in every recovery mode, including `"off"`, so a session SHALL be a
shutdown-window candidate on at most one cold start.

#### Scenario: Restart does not produce candidates

- **GIVEN** sessions running with `live: true` and non-`ended` status
- **AND** the previous boot recorded `exitIntent: "restart"`
- **WHEN** the replacement server classifies sessions on cold start
- **THEN** no session from that boot SHALL be a recovery candidate
- **AND** no recovery offer SHALL be broadcast

#### Scenario: Idle auto-stop leaves sessions recoverable

- **GIVEN** sessions running with `live: true` and non-`ended` status
- **AND** the idle timer stopped the server, recording `exitIntent: "idle"`
- **WHEN** the server next cold starts with `reopenSessionsAfterShutdown = "ask"`
- **THEN** those sessions SHALL be recovery candidates
- **AND** a recovery offer SHALL be broadcast

#### Scenario: OS shutdown leaves sessions recoverable

- **GIVEN** sessions running with `live: true` and non-`ended` status
- **AND** the previous boot recorded `exitIntent: "signal"`
- **WHEN** the server next cold starts
- **THEN** those sessions SHALL be recovery candidates

#### Scenario: OS shutdown where pi unregistered first is recoverable

- **GIVEN** sessions under boot `B` whose pi received the OS shutdown signal and unregistered, persisting `live: false`, `closedReason: "unknown"`, `liveEpoch = B` and `endedAt`
- **AND** boot `B` then recorded `exitIntent: "signal"` 23 seconds after those `endedAt` values
- **WHEN** the server next cold starts with `reopenSessionsAfterShutdown = "ask"`
- **THEN** those sessions SHALL be recovery candidates
- **AND** a recovery offer naming them SHALL be broadcast unless a keeper or bridge proves one alive

#### Scenario: Electron quit during OS shutdown is recoverable

- **GIVEN** a session under boot `B` that unregistered with `closedReason: "unknown"`
- **AND** boot `B` recorded `exitIntent: "user-quit"` within 60 seconds of that session's `endedAt`
- **WHEN** the server next cold starts
- **THEN** the session SHALL be a recovery candidate

#### Scenario: Session ended long before the shutdown is not offered

- **GIVEN** a session under boot `B` that unregistered with `closedReason: "unknown"`
- **AND** boot `B` recorded `exitIntent: "signal"` more than 60 seconds after that session's `endedAt`
- **WHEN** the server next cold starts
- **THEN** the session SHALL NOT be a recovery candidate

#### Scenario: Manually closed session is never a window candidate

- **GIVEN** a session closed from the dashboard (`closedReason: "manual"`) 5 seconds before boot `B` recorded `exitIntent: "signal"`
- **WHEN** the server next cold starts
- **THEN** the session SHALL NOT be a recovery candidate

#### Scenario: Restart, shutdown, idle and crash exits never qualify through the window

- **GIVEN** a session that unregistered with `closedReason: "unknown"` 5 seconds before its boot exited
- **AND** that boot recorded `exitIntent` of `"restart"`, `"shutdown"`, `"idle"`, or nothing (`null`)
- **WHEN** the server next cold starts
- **THEN** the session SHALL NOT be a recovery candidate through the shutdown-window path

#### Scenario: Window candidate is offered once

- **GIVEN** a session that satisfied the window conditions for boot `B` when boot `C` cold started
- **AND** recovery mode `ask`, `auto` or `off`, and the session did not run again during boot `C`
- **WHEN** boot `D` cold starts
- **THEN** the session SHALL NOT be a recovery candidate

#### Scenario: A failed replacement boot does not hide the shutdown

- **GIVEN** boot `B` recorded `exitIntent: "signal"` 23 seconds after a session's bridge unregistered
- **AND** boot `C` crashed during startup before classifying sessions
- **WHEN** boot `D` cold starts
- **THEN** the session SHALL be a recovery candidate

#### Scenario: Relocated session is never a window candidate

- **GIVEN** a session relocated to another dashboard instance 5 seconds before boot `B` recorded `exitIntent: "signal"`
- **WHEN** the server next cold starts
- **THEN** the session SHALL NOT be a recovery candidate

#### Scenario: Pre-upgrade ended sidecars are not retroactively offered

- **GIVEN** a `live: false` sidecar written before this change, carrying no `liveEpoch`
- **WHEN** the server cold starts after an upgrade
- **THEN** the session SHALL NOT be a recovery candidate

#### Scenario: Dead-process ending is never a window candidate

- **GIVEN** a session ended with `closedReason: "process_gone"` whose `endedAt` is 5 seconds before boot `B` recorded `exitIntent: "signal"`
- **WHEN** the server next cold starts
- **THEN** the session SHALL NOT be a recovery candidate

#### Scenario: User quit defers to liveness

- **GIVEN** sessions running with `live: true` and non-`ended` status
- **AND** the previous boot recorded `exitIntent: "user-quit"`
- **WHEN** the server next cold starts
- **THEN** those sessions SHALL be recovery candidates
- **AND** any candidate whose keeper or bridge proves it alive SHALL be retracted before the
  offer is broadcast, so only sessions that cannot reattach are offered

#### Scenario: Two consecutive dirty boots preserve the earlier offer

- **GIVEN** boot `A` crashed with a candidate session whose `liveEpoch = A`
- **AND** boot `B` also ended with `exitIntent: null` without the offer being resolved
- **WHEN** boot `C` classifies sessions on cold start
- **THEN** the session from boot `A` SHALL still be a recovery candidate, because `A` is
  retained in the boot-record ring and resolves to a recovery-allowing intent

