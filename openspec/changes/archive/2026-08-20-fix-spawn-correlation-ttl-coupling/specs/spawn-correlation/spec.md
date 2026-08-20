## MODIFIED Requirements

### Requirement: Token TTL aligned with `spawn-register-watchdog`
The effective TTL of a `spawnToken` SHALL be **derived** from the spawn-register
timeout — not from a literal, and not from a value captured once at server
construction.

For any one spawn, the timeout value used to arm that spawn's watchdog and the
timeout value used to derive the TTL of every correlation recorded for it SHALL
come from the **same configuration read**. Re-reading configuration between the
arm and the record SHALL NOT satisfy this requirement, because an operator
changing the setting in between would desynchronize the two.

The derived TTL SHALL equal that timeout plus the shared recovery grace window
plus an ordering margin sufficient that the correlation outlives the watchdog's
recovery window regardless of whether `record` runs before or after `arm` — both
orderings occur on existing paths.

This SHALL hold on **every** correlation-recording path — the spawn path, the
resume/fork path, and the degrade path — not only the spawn path.

When the watchdog timer fires, the `pendingClientCorrelations` entry SHALL NOT
be deleted as part of fire handling; it SHALL be evicted only by its own derived
TTL.

#### Scenario: Token outlives the timeout at the default
- **WHEN** `spawnRegisterTimeoutMs` is the default `30000`
- **THEN** the TTL recorded for a correlation SHALL exceed `30000` plus the recovery grace window
- **AND** the token SHALL still resolve at any instant before the watchdog fires

#### Scenario: Raising the timeout does not disable correlation
- **WHEN** `spawnRegisterTimeoutMs` is configured to `90000`
- **AND** a bridge registers at `t+70s` — after the old 60 s literal but BEFORE the watchdog fires
- **THEN** the correlation SHALL still resolve to the originating `requestId`
- **AND** the resulting `session_added` SHALL carry that `spawnRequestId`

#### Scenario: A live raise is honoured without a restart
- **WHEN** the server started with `spawnRegisterTimeoutMs: 30000`
- **AND** an operator raises it to `120000` without restarting
- **AND** a spawn is then issued whose bridge registers at `t+100s`
- **THEN** the correlation SHALL still resolve, its TTL having been derived from `120000`

#### Scenario: A live lowering does not desynchronize arm and TTL
- **WHEN** a spawn is in flight, armed from a configuration read of `120000`
- **AND** the operator lowers `spawnRegisterTimeoutMs` to `30000` before the correlation is recorded
- **THEN** the correlation TTL SHALL be derived from the same `120000` that armed the watchdog
- **AND** the correlation SHALL still outlive that spawn's fire

#### Scenario: Resume, fork and degrade paths derive their TTL too
- **WHEN** a correlation is recorded on the resume/fork path or the degrade path at `spawnRegisterTimeoutMs: 90000`
- **AND** the bridge registers at `t+70s`
- **THEN** the correlation SHALL still resolve
- **AND** the resulting `session_added` SHALL carry `spawnRequestId`

#### Scenario: Ordering margin covers arm-before-record
- **WHEN** a spawn is recorded on a path where `arm` runs before `record`
- **AND** a register arrives in the final milliseconds of the watchdog's recovery window
- **THEN** the correlation SHALL still be resolvable
- **AND** a `spawn_register_recovered` SHALL NOT be emitted without the accompanying `session_added` carrying `spawnRequestId`

#### Scenario: Token survives the watchdog fire
- **WHEN** a spawn's watchdog fires with no `session_register` arriving
- **THEN** the `pendingClientCorrelations` entry SHALL NOT be deleted by the fire
- **AND** it SHALL be deleted when its derived TTL elapses

### Requirement: Server echoes `requestId` and broadcasts `spawnRequestId`
When the server receives a `spawn_session` or `resume_session` carrying `requestId`, it SHALL:

1. Echo the `requestId` field in the corresponding `spawn_result` or `resume_result` message.
2. Associate the `requestId` with the minted `spawnToken` in an internal map (`pendingClientCorrelations: Map<spawnToken, requestId>`) so a later `session_register` carrying the token can be broadcast as `session_added` with the matching `spawnRequestId`.

The `session_added` browser message SHALL include `spawnRequestId?: string` populated from this map when known. This SHALL hold for any register arriving while the correlation is alive — before the watchdog fires, or after it inside the recovery window. A fired watchdog SHALL NOT by itself be a reason to omit the field.

The correlation SHALL be consumed exactly once, on the existing `session_register` handling path that performs the broadcast. No other component SHALL consume it; in particular the watchdog's clear path SHALL NOT, since a second consumer would starve the broadcast of the value it must carry.

#### Scenario: spawn_result echoes requestId
- **WHEN** the server processes `spawn_session { cwd, requestId: "rq_42" }` and emits `spawn_result`
- **THEN** the emitted `spawn_result` SHALL include `requestId: "rq_42"`

#### Scenario: resume_result echoes requestId
- **WHEN** the server processes `resume_session { sessionId, mode, requestId: "rq_99" }` and emits `resume_result`
- **THEN** the emitted `resume_result` SHALL include `requestId: "rq_99"`

#### Scenario: session_added carries spawnRequestId
- **WHEN** a bridge later registers with `spawnToken` matching the token minted for `requestId: "rq_42"`
- **AND** the new session is broadcast via `session_added`
- **THEN** the broadcast SHALL include `spawnRequestId: "rq_42"`

#### Scenario: Register after the fire still auto-selects
- **WHEN** the watchdog has already fired for the spawn minted for `requestId: "rq_42"` and the fire-time reclaim did not terminate the process
- **AND** the bridge registers with the matching `spawnToken` inside the recovery window
- **THEN** the `session_added` broadcast SHALL include `spawnRequestId: "rq_42"`
- **AND** the client SHALL clear the spawning placeholder and navigate to the new session

#### Scenario: Correlation is consumed once
- **WHEN** a late register triggers both a watchdog recovery emission and the `session_register` broadcast path
- **THEN** the correlation SHALL be consumed by the broadcast path only
- **AND** `session_added` SHALL carry the `spawnRequestId`

#### Scenario: server-initiated spawn omits spawnRequestId
- **WHEN** auto-resume-on-prompt or any other server-only flow spawns a session (no client requestId exists)
- **THEN** the resulting `session_added` broadcast SHALL omit `spawnRequestId`

## ADDED Requirements

### Requirement: The fork registry derives its expiry from the same timeout
`pendingForkRegistry` SHALL derive its per-entry expiry from the spawn-register
timeout in force for that spawn, by the same rule as
`pendingClientCorrelations`. Its current hardcoded `30000` is shorter than the
default timeout itself, so a fork whose bridge registers late loses its parent
placement even at the default configuration.

This requirement SHALL NOT be generalized to every `pending*` registry. A TTL
that exists to *bound* the damage of a failed spawn is a different mechanism
from one that must survive until the bridge registers, and lengthening the
former is a regression. Specifically, `pendingAttachRegistry` (whose TTL stops a
failed spawn stranding an intent that would later attach to an unrelated
session) and `pendingResumeIntentRegistry` (whose TTL stops a failed spawn
poisoning a later legitimate reattach, and which is consumed on the ended→alive
transition rather than on register) SHALL retain their current bounds.

#### Scenario: Fork correlation survives a late register at the default timeout
- **WHEN** `spawnRegisterTimeoutMs` is the default `30000`
- **AND** a forked session's bridge registers at `t+29s`
- **THEN** the fork registry entry SHALL still be consumable
- **AND** the forked session SHALL be placed after its parent

#### Scenario: Fork correlation survives a raised timeout
- **WHEN** `spawnRegisterTimeoutMs` is `90000` and a forked session's bridge registers at `t+70s`
- **THEN** the fork registry entry SHALL still be consumable

#### Scenario: Attach registry keeps its anti-strand bound
- **WHEN** `spawnRegisterTimeoutMs` is raised to `120000`
- **THEN** the pending-attach expiry SHALL be unchanged
- **AND** a failed spawn's attach intent SHALL NOT remain eligible any longer than it does today

#### Scenario: Resume-intent registry keeps its anti-poison bound
- **WHEN** `spawnRegisterTimeoutMs` is raised to `120000`
- **THEN** the pending-resume-intent expiry SHALL be unchanged
- **AND** a failed spawn's intent SHALL NOT be able to mis-tag a later bridge reattach for longer than it can today

### Requirement: `hidden` is not decided from the bridge's self-reported source
The auto-hide heuristic in `memory-session-manager.register` SHALL NOT read the
bridge's self-reported `params.source`, which is evaluated before the server's
dashboard-source decision has been made and can therefore never be
`"dashboard"` at that point. It SHALL instead read the strong dashboard-spawn
signal the bridge carries on `session_register`.

That signal is not currently forwarded into `register`; forwarding it is part of
this requirement. Changing the heuristic without it would evaluate an absent
value and hide every dashboard-spawned headless session.

The signal is untrusted input and SHALL be normalized to a strict boolean on the
way in, exactly as `hasUI` and `visibilityIntent` already are, so a malformed
payload cannot skew visibility. Because the bridge omits the field rather than
sending `false`, an absent field SHALL be treated as "not dashboard-spawned".

The existing precedence SHALL be preserved exactly: a reattach with a prior
record keeps the prior `hidden`; an explicit `visibilityIntent` wins over the
heuristic; only when neither applies does the headless heuristic decide. The
value SHALL be computed once and SHALL NOT be recomputed or overwritten later.

#### Scenario: The dashboard-spawn signal reaches the register call
- **WHEN** a `session_register` carrying the dashboard-spawn signal is handled
- **THEN** that signal SHALL be passed into `memory-session-manager.register`
- **AND** the heuristic SHALL evaluate it rather than the self-reported source

#### Scenario: Dashboard spawn reporting hasUI=false is not hidden
- **WHEN** a bridge registers with `hasUI: false`, self-reported `source: "tui"`, and the dashboard-spawn signal set
- **AND** no `visibilityIntent` is supplied and this is a first register
- **THEN** the session SHALL be stored with `hidden: false`
- **AND** it SHALL appear in the sidebar through `filterSessions`

#### Scenario: Genuine headless worker is still hidden
- **WHEN** a bridge registers with `hasUI: false` and no dashboard-spawn signal
- **AND** no `visibilityIntent` is supplied and this is a first register
- **THEN** the session SHALL be stored with `hidden: true`

#### Scenario: Explicit visibilityIntent still wins
- **WHEN** a bridge registers with `hasUI: false`, no dashboard-spawn signal, and `visibilityIntent: "visible"`
- **THEN** the session SHALL be stored with `hidden: false`
- **AND** a register with `visibilityIntent: "hidden"` SHALL be stored with `hidden: true` regardless of the other inputs

#### Scenario: Reattach preserves a manual hide
- **WHEN** a session already recorded as `hidden: true` re-registers with `registerReason: "reattach"`
- **AND** the register reports `hasUI` as `undefined`
- **THEN** the stored `hidden` SHALL remain `true`
- **AND** the heuristic SHALL NOT have been consulted

#### Scenario: hasUI true is never hidden by the heuristic
- **WHEN** a bridge registers with `hasUI: true` on a first register with no `visibilityIntent`
- **THEN** the session SHALL be stored with `hidden: false`
