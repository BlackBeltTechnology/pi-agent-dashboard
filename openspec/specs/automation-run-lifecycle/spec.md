# automation-run-lifecycle Specification

## Purpose
TBD - created by archiving change add-automation-plugin. Update Purpose after archive.
## Requirements
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

A user SHALL be able to stop a `running` automation run from the board. Stopping SHALL abort the run's spawned session via a host-provided `abortSession(sessionId)` capability exposed on `ServerPluginContext` (gated to trusted plugins like `spawnSession`) and SHALL finalize the run record. Finalization SHALL be idempotent with the normal `agent_end` capture path: a stopped run SHALL be finalized exactly once, and a subsequent end event for that session SHALL NOT re-finalize or duplicate the record.

#### Scenario: Stop aborts the run session and finalizes the record

- **WHEN** a user stops a `running` run
- **THEN** the run's session SHALL be sent an abort via `abortSession(sessionId)` AND the run record SHALL transition out of `running`.

#### Scenario: Stop is idempotent with agent_end

- **WHEN** a stopped run's session later emits `agent_end`
- **THEN** the run SHALL NOT be finalized a second time and no duplicate run record SHALL be produced.

#### Scenario: Untrusted plugins cannot abort sessions

- **WHEN** an untrusted plugin holds a `ServerPluginContext`
- **THEN** its `abortSession` SHALL be a no-op returning `false`, mirroring the `spawnSession` trust gate.

### Requirement: Run result records a findings count

When a run finishes, its record SHALL carry a `findings` count derived from `result.md`. The count SHALL be the number of findings captured (heuristic: top-level markdown bullet lines), and SHALL be `0` for a run that produced no assistant output and was auto-archived. The `/runs` route payload SHALL include `findings` so the client can show it without fetching `result.md`.

#### Scenario: Findings counted from result.md

- **WHEN** a run finishes with a `result.md` containing N top-level finding bullets
- **THEN** its run record SHALL report `findings: N`.

#### Scenario: Empty run reports zero findings

- **WHEN** a run produces no assistant output and is auto-archived
- **THEN** its run record SHALL report `findings: 0`.

