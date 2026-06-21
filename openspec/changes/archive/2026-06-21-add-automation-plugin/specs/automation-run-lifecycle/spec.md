# automation-run-lifecycle

## ADDED Requirements

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
