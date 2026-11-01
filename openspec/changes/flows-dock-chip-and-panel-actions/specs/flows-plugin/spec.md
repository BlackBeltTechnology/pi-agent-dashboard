## MODIFIED Requirements

### Requirement: Flow rendering is packaged as a workspace plugin
The dashboard SHALL ship flow rendering as a dedicated workspace package at `packages/flows-plugin/`. The package SHALL declare a `pi-dashboard-plugin` manifest field claiming the slots that mount its UI components, and SHALL expose its reducer logic via an `exports` map so that `packages/client/src/lib/event-reducer.ts` can import it as a workspace dependency.

#### Scenario: Workspace dependency wired
- **WHEN** the dashboard is built from a fresh checkout
- **THEN** `packages/client/package.json` SHALL list `@blackbelt-technology/pi-dashboard-flows-plugin` as a dependency
- **AND** `packages/flows-plugin/package.json` SHALL include a `pi-dashboard-plugin` manifest field
- **AND** the manifest SHALL claim at minimum: `session-card-flows` (flow status), `session-card-action-bar` (the flowless authoring entry point, rendered in the session actions menu), `composer-context-group` (the FLOWS dock chip), `content-header-sticky`, `content-view` (route `flow-agent-detail/:agentId`), `content-view` (route `architect-detail`)
- **AND** the manifest SHALL NOT claim `session-card-badge` (see `flows-running-status-pill`)

### Requirement: Flow actions and the FLOWS subcard are gated separately

The flows plugin SHALL use three gates:
- **Availability.** Flows is available when the pi-flows extension is active in the session's cwd, detected by a command named `flows` or starting with `flows:` in the session's `commandsList`, OR when the session has any flow event (live or replayed). The removed `flows:new` command SHALL NOT be used as a signal.
- **Menu gate.** The `session-card-action-bar` claim SHALL contribute to the session actions menu only when the session's flow catalog (see `flows-catalog`) is known to be empty. A published catalog proves pi-flows answered, so the menu gate SHALL NOT also require the availability signal. It SHALL then contribute exactly one item: **New flow…** when the session's effective edit mode is on, or "Turn on edit mode for this project" when it is off. It SHALL contribute nothing while the catalog is unknown, while edit mode is unknown, or when the catalog lists any flow.
- **Chip gate.** The FLOWS dock chip (see `flows-dock-chip`) SHALL render iff the session's flow catalog lists at least one flow. A published catalog proves pi-flows answered, so the chip SHALL NOT also require the availability signal.
- **Subcard gate.** The `session-card-flows` claim (the FLOWS subcard, carrying flow status only) SHALL render only when the session has any flow event (live or replayed).

The availability cache SHALL remain closed by default (unavailable until the first `commandsList` publish for the session) and SHALL recompute on `commandsList` publishes and on flow catalog changes.

The action-bar claim and the dock chip SHALL NOT send any edit-mode message when they mount, when flows becomes available, or when they re-render. Edit mode reaches a session only through the explicit per-project action (see `flows-edit-mode-settings`).

#### Scenario: Active-but-empty flows cwd offers authoring in the menu
- **WHEN** a session's flow catalog is known and empty, its effective edit mode is on, and it has no flow events
- **THEN** the session actions menu SHALL offer **New flow…** as the only flows item
- **AND** no FLOWS subcard and no FLOWS dock chip SHALL render

#### Scenario: Flowless session with edit mode off
- **WHEN** a session's flow catalog is known and empty and its effective edit mode is off
- **THEN** the session actions menu SHALL offer only "Turn on edit mode for this project" from the flows plugin

#### Scenario: Catalog unknown offers nothing in the menu
- **WHEN** no catalog has been seen for the session
- **THEN** the flows plugin SHALL contribute nothing to the session actions menu

#### Scenario: Session with flows contributes nothing to the menu
- **WHEN** the session's flow catalog lists `batch:apply`
- **THEN** the session actions menu SHALL show no flows plugin item
- **AND** the FLOWS dock chip SHALL render

#### Scenario: A run shows the FLOWS subcard
- **WHEN** a session has any `flow_*` event (live or replayed)
- **THEN** the FLOWS subcard SHALL render its flow status

#### Scenario: No flows command and no events offers nothing
- **WHEN** a session has no `flows` / `flows:*` command, no flow event, and no catalog
- **THEN** no flow action SHALL appear in the menu or the dock and no FLOWS subcard SHALL render

#### Scenario: Closed by default before first publish
- **WHEN** no `commandsList` has been published for a session, it has no flow events and no catalog
- **THEN** no flow action SHALL appear and no FLOWS subcard SHALL render

#### Scenario: Edit-mode reconcile runs without opening the menu
- **WHEN** flows becomes available for a session and the menu has never been opened
- **THEN** no `flow_management` `set-edit-mode` message SHALL be sent for that session (the reconcile is removed; this scenario name is kept for delta continuity)

### Requirement: Flows registers automation actions

The flows plugin SHALL register `flows.run` as an automation action that dispatches by **emitting a configured event** into the run session (not by seeding a slash-command prompt), gated on flows existing in the cwd. The set of "flows in the cwd" SHALL be the live per-session flows list held by the flows-plugin server (`stateStore`, populated from the session's flow catalog events, see `flows-catalog`), resolved by mapping the cwd to its running pi session(s) via the plugin `sessionManager` and unioning their reported flows. The gate SHALL NOT be a static filesystem scan of `<cwd>/.pi/flows/flows/`, so package-bundled and event-registered flows (which pi-flows discovers at runtime) are reflected. `flows.run` SHALL declare a `flow` enum field (options = the same live cwd flows list) and a `task` multiline field. It SHALL declare `emits: ["flow:run"]`. Its `buildEvent` SHALL return `{ eventType: "flow:run", data: { flowName, task } }`; a malformed `flow` id SHALL emit nothing (`null`). Its event SHALL declare `completion: { eventType: "flow_complete" }`; run finalization is governed by `automation-run-lifecycle`.

When no running pi session exists for the cwd, the live flows list SHALL be empty and `flows.run` SHALL be reported as unavailable (present-but-disabled) for that cwd.

The flows plugin SHALL NOT register `flows.resume` or `flows.cancel` — pi-flows exposes no run-scoped resume/cancel command reachable by the automation dispatch path. Registration SHALL be a no-op (with a warning) when the action registry is absent, and SHALL honor the registry's rejection result.

#### Scenario: flows.run available from live session flows

- **WHEN** a pi session is running for cwd `/w/invoice-bot` and its flow catalog contains `invoicebot:pull` (a package/event-registered flow not present under `<cwd>/.pi/flows/flows/`)
- **THEN** `available(cwd)` SHALL return true and the `flow` enum options SHALL include `invoicebot:pull`.

#### Scenario: flows.run unavailable with no live session

- **WHEN** no pi session is running for cwd `/w/invoice-bot`
- **THEN** `available(cwd)` SHALL return false and the dialog SHALL surface `flows.run` as present-but-disabled.

#### Scenario: flows.run emits flow:run

- **WHEN** `flows.run` fires with `payload { flow: "test:x", task: "go" }`
- **THEN** its `buildEvent` SHALL return `{ eventType: "flow:run", data: { flowName: "test:x", task: "go" } }` with a `flow_complete` completion declaration, and `flow:run` SHALL be listed in the action's `emits`.

#### Scenario: malformed flow id emits nothing

- **WHEN** `flows.run` fires with a `flow` payload that is not `<ns>:<name>`
- **THEN** its `buildEvent` SHALL return `null` and no event SHALL be emitted.

#### Scenario: resume and cancel are not offered

- **WHEN** the flows plugin registers its actions
- **THEN** neither `flows.resume` nor `flows.cancel` SHALL be present in the registry.
