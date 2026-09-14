# shutdown-session-recovery Specification

## MODIFIED Requirements

### Requirement: Intentional close SHALL clear the liveness marker with a reason

When a session is closed intentionally — manual close (`handleShutdown`), force-kill (`handleForceKill`), a clean server `stop()` tearing the session down, or ANY session unregister (explicit `session_unregister`, heartbeat expiry, run termination) — the server SHALL persist `{ live: false }` to the session's `.meta.json`. The unregister-path write SHALL be eager (atomic, not debounced): `unregister()` persists `status: "ended"` through the 1s-debounced save, and without an eager `live: false` a host death inside that window leaves `live: true` + a non-`ended` status on disk — the next cold start would offer (or in `auto` mode, silently respawn) a session that ended cleanly. Manual close and force-kill SHALL additionally persist `closedReason: "manual"`.

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

#### Scenario: Manual close stamps closedReason

- **GIVEN** a running session with `live: true`
- **WHEN** the user closes it (a `shutdown` / `force_kill` message handled by the server)
- **THEN** the session's `.meta.json` SHALL be updated to `live: false`
- **AND** SHALL contain `closedReason: "manual"`

#### Scenario: Clean server stop clears liveness without manual reason

- **GIVEN** running sessions with `live: true`
- **WHEN** the server performs a clean `stop()` (idle timer or app quit)
- **THEN** each torn-down session's `.meta.json` SHALL be updated to `live: false`
- **AND** SHALL NOT set `closedReason: "manual"`

#### Scenario: An involuntary reason does not disqualify recovery

- **GIVEN** a session that ended with a non-`manual` involuntary reason
- **WHEN** the server classifies recovery candidates at cold start
- **THEN** the session SHALL be evaluated exactly as it is today
- **AND** the new reason SHALL NOT cause it to be excluded
