# automation-run-lifecycle Specification

## Purpose
TBD - created by archiving change add-automation-plugin. Update Purpose after archive.
## Requirements
### Requirement: Dispatch delivery by action kind

When a run session registers, the engine SHALL deliver the run's action dispatch resolved at start: for a prompt action it SHALL seed the prompt text via `sendToSession`; for an event action it SHALL emit the configured event via `emitEventToSession`. Delivery SHALL happen exactly once per run and only after the session is correlated to the run by its `runId` stamp. Run finalization SHALL remain on `agent_end` for both kinds.

#### Scenario: Event action delivery

- **WHEN** a run for an event action's automation registers its session
- **THEN** the engine SHALL emit the action's configured event into that session and SHALL NOT send a text prompt.

#### Scenario: Prompt action delivery unchanged

- **WHEN** a run for a prompt action registers its session
- **THEN** the engine SHALL seed the prompt text via `sendToSession` and finalize on `agent_end` as before.

### Requirement: Event-dispatch actions declare their completion signal

An event-dispatch action contribution (one providing `buildEvent`) MAY declare,
in its `buildEvent` return, a `completion` object naming the forwarded event type
that signals a run of that action has finished, plus an optional summarizer that
derives the run result from that event's payload. The completion declaration
travels across the action publish/collect bus with the rest of the contribution;
the automation plugin SHALL NOT hardcode any action-specific completion event.

#### Scenario: Action declares completion alongside its start event

- **WHEN** an action's `buildEvent` returns `{ eventType, data, completion: { eventType, summarize } }`
- **THEN** the collected registry carries the `completion` declaration for that run's dispatch.

### Requirement: Event-dispatched runs finalize on their declared completion event

An event-dispatched run produces no agent turn in the host session and therefore
emits no `agent_end`. When such a run declared a `completion` event, the engine
SHALL finalize the run the first time it observes that declared event for the
run's session: it captures the run result (buffered assistant text if any, else
the declared summarizer applied to the event payload) and calls `onSessionEnded`,
which terminates the now-idle spawned session and frees the concurrency slot.
Finalization SHALL occur exactly once; a later `agent_end` is a no-op. A run that
did not declare a completion event (including every prompt-dispatch run) SHALL
continue to finalize on `agent_end`.

#### Scenario: Event-dispatched run finalizes on its declared completion event

- **WHEN** a tracked run that declared `completion.eventType` observes that event
- **THEN** the run finalizes once with the summarized result and its spawned
  session is terminated so the next scheduled fire can start.

#### Scenario: Prompt-dispatched run is unaffected by the completion event

- **WHEN** a prompt-dispatch run (no declared completion) observes an unrelated
  forwarded event
- **THEN** it is not finalized by it and still finalizes on `agent_end`.

#### Scenario: agent_end after completion is a no-op

- **WHEN** an event-dispatched run already finalized on its declared completion
  event later observes an `agent_end`
- **THEN** no second finalization occurs.

### Requirement: Runs spawn automation sessions with configurable board visibility

A fired trigger SHALL spawn a pi session stamped `kind="automation"` carrying `automationRun { name, runId }`, launched via a `ServerPluginContext` spawn hook with the resolved model, action, `mode`, and `sandbox`. The session SHALL ALWAYS appear in the Automation view. Whether it ALSO appears on the normal board SHALL be governed by an effective visibility = the automation's `visibility` field if present, else the settings-level default (default `hidden`). When effective visibility is `hidden` the run SHALL be excluded from the board; when `shown` it SHALL render as a normal board card.

#### Scenario: Hidden run absent from board, present in Automation view

- **WHEN** a run spawns with effective visibility `hidden`
- **THEN** it SHALL NOT render as a top-level board card AND SHALL appear in the Automation view's run list with status `running`.

#### Scenario: Shown run appears on board

- **WHEN** a run spawns with effective visibility `shown`
- **THEN** it SHALL render as a top-level board card AND SHALL also appear in the Automation view.

#### Scenario: Per-automation visibility overrides settings default

- **WHEN** the settings default is `hidden` and an automation declares `visibility: shown`
- **THEN** that automation's runs SHALL appear on the board while other automations' runs stay hidden.

### Requirement: Action prompt delivered to the correlated run session

The engine SHALL deliver a run's action prompt to the exact session it spawned for that run, correlated by the host-applied `automationRun.runId` stamp. Correlation SHALL NOT rely on the run session's working directory: when other sessions share the run's `cwd`, the prompt SHALL still reach only the spawned run session. A session that does not carry a matching `automationRun.runId` stamp SHALL NOT receive the prompt, and the run SHALL remain `running` until its own stamped session registers.

#### Scenario: Prompt reaches the spawned session despite same-cwd siblings

- **WHEN** a run is spawned in a `cwd` where one or more unrelated sessions are already active and emitting events
- **THEN** the action prompt SHALL be delivered only to the session stamped with that run's `runId`, AND the run SHALL progress to `done` once that session ends.

#### Scenario: Unrelated same-cwd session never captures the prompt

- **WHEN** an unrelated session at the run's `cwd` emits events before the spawned run session registers
- **THEN** that session SHALL NOT receive the run's action prompt AND SHALL NOT be bound to the run.

### Requirement: Model resolution at spawn time

When `model` is an `@role` alias, it SHALL be resolved to a concrete provider/model at spawn time via the roles plugin. A bare provider/model id SHALL be used as-is. An unresolvable `@role` SHALL fall back to a configured default model and surface a run error rather than silently selecting a model.

#### Scenario: @role resolved live

- **WHEN** an automation with `model: "@fast"` fires and `@fast` maps to a concrete model
- **THEN** the run SHALL spawn with that concrete model.

#### Scenario: Unresolvable role surfaces error

- **WHEN** an automation references `@gone` which has no assignment
- **THEN** the run SHALL use the configured default model AND record a run error noting the unresolved role.

### Requirement: Run monitoring reuses ChatView

The Automation view SHALL let a user open a run's live transcript by rendering the existing chat/timeline view (`ChatView`) addressed by the run's session id, showing the run's tool calls and messages.

#### Scenario: Watch a running automation

- **WHEN** a user opens a `running` automation run
- **THEN** the run's live tool calls and messages SHALL render via the standard ChatView.

### Requirement: Concurrency policy per automation

When a trigger fires while a prior run for the same automation is still active, behavior SHALL follow the automation's `concurrency` field: `skip` (drop, default), `queue` (start when prior ends), or `parallel` (start immediately).

#### Scenario: skip drops overlapping fire

- **WHEN** `concurrency: skip` and a run is active at the next fire
- **THEN** no new run SHALL start and the skipped fire SHALL be logged.

#### Scenario: queue defers overlapping fire

- **WHEN** `concurrency: queue` and a run is active at the next fire
- **THEN** a new run SHALL start after the active run ends.

### Requirement: Run result captures assistant output, not the injected prompt

A run's `result.md` SHALL contain the run session's assistant message output. The action prompt the engine injects into the run session (delivered via `sendToSession`) SHALL NOT appear in `result.md`. Only events carrying assistant message text SHALL be captured; a text-bearing event without an explicit `assistant` role SHALL NOT be treated as run output.

A run whose session produces no assistant output SHALL flush an empty result and SHALL be auto-archived (consistent with the existing "no findings" rule), regardless of the injected prompt having been delivered.

#### Scenario: Assistant reply captured, prompt excluded

- **WHEN** a run session is delivered the action prompt, the model replies with assistant text, and the session emits `agent_end`
- **THEN** `result.md` SHALL contain the assistant reply text AND SHALL NOT contain the injected action prompt

#### Scenario: No assistant output auto-archives

- **WHEN** a run session is delivered the action prompt but emits no assistant message text before `agent_end`
- **THEN** `result.md` SHALL be empty AND the run record SHALL be marked archived

#### Scenario: Role-less echo is not captured

- **WHEN** the run session emits a text-bearing event with no explicit `assistant` role (e.g. the injected-prompt echo)
- **THEN** that text SHALL NOT be appended to the run result

### Requirement: A running run can be stopped by the user

A user SHALL be able to stop a `running` automation run from the board. Stopping SHALL **terminate the run's spawned process** via a trusted host-provided capability on `ServerPluginContext` (gated to trusted plugins like `spawnSession`), and SHALL finalize the run record only after the termination has been attempted. Termination SHALL succeed regardless of run state, including the window after the run record is `running` but before its spawned session has registered — the host capability SHALL accept a `spawnToken` (captured at spawn time) so a not-yet-registered run can be killed by process handle, and SHALL accept a `sessionId` for a registered run. Finalization SHALL be idempotent with the normal `agent_end` capture path: a stopped run SHALL be finalized exactly once, and a subsequent end event for that session SHALL NOT re-finalize or duplicate the record.

#### Scenario: Stop terminates a registered run and finalizes the record

- **WHEN** a user stops a `running` run whose session has registered
- **THEN** the run's process SHALL be terminated via the host capability keyed by its `sessionId` AND the run record SHALL transition out of `running`.

#### Scenario: Stop during the spawn→register window terminates by spawnToken

- **GIVEN** a run whose record is `running` but whose spawned session has not yet registered (no `sessionId` bound)
- **WHEN** a user stops the run
- **THEN** the run's process SHALL be terminated via the host capability keyed by its `spawnToken`
- **AND** the run record SHALL be finalized
- **AND** no orphaned/never-signaled session SHALL remain after the spawned session finishes registering.

#### Scenario: A no-op soft abort does not silently finalize a live run

- **WHEN** stopping a run and the soft turn-abort cannot be delivered (e.g. the bridge WebSocket is not open)
- **THEN** the stop SHALL still terminate the process via the host kill capability rather than finalizing the record while the process keeps running.

#### Scenario: Stop is idempotent with agent_end

- **WHEN** a stopped run's session later emits `agent_end`
- **THEN** the run SHALL NOT be finalized a second time and no duplicate run record SHALL be produced.

#### Scenario: Untrusted plugins cannot terminate sessions

- **WHEN** an untrusted plugin holds a `ServerPluginContext`
- **THEN** its run-termination capability SHALL be a no-op returning `false`, mirroring the `spawnSession` trust gate.

### Requirement: Run result records a findings count

When a run finishes, its record SHALL carry a `findings` count derived from `result.md`. The count SHALL be the number of findings captured (heuristic: top-level markdown bullet lines), and SHALL be `0` for a run that produced no assistant output and was auto-archived. The `/runs` route payload SHALL include `findings` so the client can show it without fetching `result.md`.

#### Scenario: Findings counted from result.md

- **WHEN** a run finishes with a `result.md` containing N top-level finding bullets
- **THEN** its run record SHALL report `findings: N`.

#### Scenario: Empty run reports zero findings

- **WHEN** a run produces no assistant output and is auto-archived
- **THEN** its run record SHALL report `findings: 0`.

### Requirement: A completed run SHALL terminate its spawned session

Automation runs are spawned as persistent `--mode rpc` pi sessions that do not self-exit when a turn ends. When a run completes normally (its session emits `agent_end`) and the result has been captured, the run's spawned session SHALL be terminated so no idle pi process is left running. Termination on completion SHALL send a graceful clean-exit hint (session shutdown) AND SHALL always escalate to a hard process kill, unconditionally — not gated on whether the hint succeeds, because the hint is undeliverable when the bridge WebSocket is not open. This SHALL reuse the same host-provided, trust-gated termination capability used by user-initiated Stop.

#### Scenario: Completed run's session is ended

- **WHEN** a run's session emits `agent_end` and its result is captured
- **THEN** the run's spawned session SHALL be terminated
- **AND** no idle pi process for that run SHALL remain after finalization.

#### Scenario: Termination is idempotent with finalization

- **WHEN** terminating a completed run's session causes a further session-end signal
- **THEN** the run SHALL NOT be finalized a second time and no duplicate run record SHALL be produced.

### Requirement: Headless automation runs finalize on session death

A tracked `kind="automation"` run SHALL be finalized when its spawned session
ends without first delivering a terminal event (`agent_end` or its declared
completion event). Session death includes the gateway observing a connection
close and/or a heartbeat timeout for that run's session. Because a headless
automation session is one-shot and never reconnects, the engine SHALL NOT hold
such a session in the reconnect-grace path; it SHALL route the close signal to
the same finalize seam used by the terminal-event paths (`onSessionEnded` →
finalize + `completeRun`), so the run leaves `running` and its concurrency slot
is freed. Finalization SHALL capture the run's last-known buffered result if one
exists; otherwise it SHALL record the run as `error` with a reason indicating the
session ended before completion. Finalization SHALL be idempotent: a later
forwarded completion event or `agent_end` for that session SHALL be a no-op.

This trigger is additive. Prompt-dispatch runs and runs that emit `agent_end` or
their declared completion event SHALL continue to finalize on those signals
exactly as before.

#### Scenario: Code-only run whose session dies before its completion event

- **GIVEN** a `running` event-dispatched automation run whose flow is code-only
- **WHEN** the run's session closes its connection / times out its heartbeat
  before the forwarded completion event arrives, with no reconnect
- **THEN** the engine SHALL finalize the run exactly once
- **AND** SHALL record `error` with a "session ended before completion" reason
  when no result was buffered
- **AND** SHALL free the automation's concurrency slot so the next scheduled fire
  can start.

#### Scenario: Forwarded completion arriving after session-death finalize is a no-op

- **GIVEN** a run already finalized via the session-death path
- **WHEN** its declared completion event or an `agent_end` is later observed for
  that session
- **THEN** no second finalization SHALL occur and no duplicate run record SHALL be
  produced.

#### Scenario: A live human session is not finalized by this path

- **WHEN** a non-`kind="automation"` session closes its connection within the
  reconnect-grace window
- **THEN** the reconnect-grace behavior SHALL be unchanged and no automation run
  finalization SHALL be triggered.

### Requirement: A stale running automation run is reaped

A `running` automation run whose age exceeds a configurable maximum SHALL be
reaped: transitioned to a terminal `error` status and its concurrency slot freed
via `completeRun`. The reaper SHALL run independently of any forwarded event or
session signal, guaranteeing that a lost terminal event can never wedge an
automation's schedule permanently. Reaping SHALL be idempotent with every other
finalize path: a run already finalized SHALL NOT be reaped, and a terminal signal
arriving after a reap SHALL be a no-op.

#### Scenario: Overdue running run is reaped and its slot freed

- **GIVEN** an automation run in `running` past the configured maximum age
- **WHEN** the reaper sweep evaluates it
- **THEN** the run SHALL transition to `error`
- **AND** the automation's concurrency slot SHALL be freed so subsequent fires
  are no longer dropped.

#### Scenario: Reaper does not touch a healthy in-progress run

- **GIVEN** an automation run in `running` within the configured maximum age
- **WHEN** the reaper sweep evaluates it
- **THEN** the run SHALL be left untouched.

#### Scenario: Terminal signal after reap is a no-op

- **GIVEN** a run already reaped to `error`
- **WHEN** a forwarded completion event or `agent_end` later arrives for that run
- **THEN** no re-finalization SHALL occur and no duplicate record SHALL be
  produced.

