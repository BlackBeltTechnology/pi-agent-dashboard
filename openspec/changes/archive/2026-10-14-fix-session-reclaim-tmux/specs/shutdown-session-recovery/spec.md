## MODIFIED Requirements

### Requirement: Intentional close SHALL clear the liveness marker with a reason

When a session is closed intentionally — manual close (`handleShutdown`), force-kill (`handleForceKill`), or ANY session unregister (explicit `session_unregister`, heartbeat expiry, run termination) — the server SHALL persist `{ live: false }` to the session's `.meta.json`. The unregister-path write SHALL be eager (atomic, not debounced): `unregister()` persists `status: "ended"` through the 1s-debounced save, and without an eager `live: false` a host death inside that window leaves `live: true` + a non-`ended` status on disk — the next cold start would offer (or in `auto` mode, silently respawn) a session that ended cleanly. Manual close and force-kill SHALL additionally persist `closedReason: "manual"`.

A server-initiated reclaim is also an intentional close: the idle reaper's kill
gears (`idle`, `phantom`), the active-session caps reclaim, and the termination of
an automation run's spawned session SHALL stamp the in-memory `closedReason:
"manual"` on the session record BEFORE pi is signalled, using the same pre-signal
stamp the dashboard Stop uses, so pi's own `session_unregister` (sent from its
SIGTERM handler) cannot record the reclaim as `unknown` and qualify it as a
shutdown-window recovery candidate. The stamp SHALL be applied only to a record
that is not yet ended and carries no reason. When the reclaim's termination is NOT
confirmed and the record is still not ended, the stamp SHALL be withdrawn (the
reason restored to unset), so a session that survives a failed reclaim is not
labelled as closed. A reclaim with no session record (an automation run stopped
before its session registered) has nothing to stamp.

When the session ended because its bridge sent an explicit `session_unregister` (pi exiting gracefully — `/quit`, session switch, or an OS signal), the same eager end write SHALL also persist the session's `endedAt` and the `liveEpoch` of the server boot in which the session ENDED (not the epoch it was last activated under). Both values SHALL be durable on disk even when the debounced save never flushes. A session closed from the dashboard (Stop or force-kill) SHALL be marked `closedReason: "manual"` before pi is signalled, so a bridge unregister racing the close cannot record it as `unknown`. No other ending — manual close, force-kill, a server-initiated reclaim, heartbeat or reconnect-grace expiry, history or placeholder cleanup, finalize-on-close, spawn failure, or RELOCATION to another dashboard instance — SHALL persist that `liveEpoch`, so none of them can qualify as a shutdown-window recovery candidate. Re-firing the end write for the same session within the same boot SHALL keep the evidence unchanged while `closedReason` is still `"unknown"`, and SHALL remove the `liveEpoch` once the reason is refined to any other value. A re-fire SHALL NEVER write a different `liveEpoch` or `endedAt`.

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

#### Scenario: A reaped session is not a shutdown-window recovery candidate

- **GIVEN** a running `ephemeral` session spawned under any strategy
- **WHEN** the idle reaper, the caps reclaim, or an automation run termination
  signals its pi process and pi's bridge sends `session_unregister` in response
- **THEN** the session SHALL end with `closedReason: "manual"`
- **AND** its `.meta.json` SHALL NOT carry a `liveEpoch`

#### Scenario: A failed reclaim does not leave a close reason on a live session

- **GIVEN** a running session whose server-initiated reclaim is not confirmed
- **WHEN** the reclaim reports its outcome and the session has not ended
- **THEN** the session's in-memory `closedReason` SHALL be unset again

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

