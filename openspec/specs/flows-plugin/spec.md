# flows-plugin Specification

## Purpose

Flow rendering for the pi-dashboard, packaged as a dedicated workspace plugin (`packages/flows-plugin/`). Owns the `FlowState` lifecycle on the client — the reducer arms for every `flow_*` event — and claims dashboard plugin slots that mount its UI (`FlowDashboard`, `FlowActivityBadge`, `FlowSummary`, `FlowAgentDetail`).

The flow types (`FlowState`, `FlowAgentState`, `FlowAgentStatus`, `FlowAgentCardConfig`, `NodeKind`) are owned by this plugin and live in `packages/flows-plugin`, not in `packages/shared`. `SessionState` SHALL NOT carry a flow field; the plugin keeps its per-session flow slice through its registered session-event reducer on the client and its server state store. See change: update-flows-plugin.

The motivating design lives in `openspec/changes/extract-flows-as-plugin/design.md`.

## Requirements

### Requirement: Flow rendering is packaged as a workspace plugin
The dashboard SHALL ship flow rendering as a dedicated workspace package at `packages/flows-plugin/`. The package SHALL declare a `pi-dashboard-plugin` manifest field claiming the slots that mount its UI components, and SHALL expose its reducer logic via an `exports` map so that `packages/client/src/lib/event-reducer.ts` can import it as a workspace dependency.

#### Scenario: Workspace dependency wired
- **WHEN** the dashboard is built from a fresh checkout
- **THEN** `packages/client/package.json` SHALL list `@blackbelt-technology/pi-dashboard-flows-plugin` as a dependency
- **AND** `packages/flows-plugin/package.json` SHALL include a `pi-dashboard-plugin` manifest field
- **AND** the manifest SHALL claim at minimum: `session-card-flows` (flow status), `session-card-action-bar` (the flowless authoring entry point, rendered in the session actions menu), `composer-context-group` (the FLOWS dock chip), `content-header-sticky`, `content-view` (route `flow-agent-detail/:agentId`), `content-view` (route `architect-detail`)
- **AND** the manifest SHALL NOT claim `session-card-badge` (see `flows-running-status-pill`)

### Requirement: flow_started event handling owned by flows-plugin
The `flows-plugin` package SHALL export a reducer function that handles `flow_started` by creating a new `FlowState` with the flow name, task, status `"running"`, and pre-populated agent entries (from the `steps` array) in pending status with their `blockedBy` dependencies. The flows plugin's registered session-event reducer SHALL apply it to the plugin-owned per-session flow slice when a `flow_started` event arrives. The core event reducer SHALL NOT invoke it, and core `SessionState` SHALL NOT hold the result.

#### Scenario: Flow started creates flow state
- **WHEN** a `flow_started` event with `{ flowName: "research", task: "Find bugs", steps: [{id: "r", agent: "researcher", blockedBy: []}, {id: "d", agent: "developer", blockedBy: ["r"]}] }` is processed
- **THEN** the plugin flow slice for that session SHALL be set with `flowName: "research"`, two agents in pending status, and `developer` SHALL have `blockedBy: ["r"]`
- **AND** core `SessionState` SHALL carry no flow field

### Requirement: flow_agent_started event handling owned by flows-plugin
The plugin's reducer SHALL update the agent's status to `"running"` and store the config metadata (label, model, card role) when `flow_agent_started` is processed.

#### Scenario: Agent starts running
- **WHEN** a `flow_agent_started` event with `{ agentName: "researcher", config: { model: "@research", card: { label: "Research" } } }` is processed
- **THEN** the agent's status SHALL be `"running"` and label SHALL be `"Research"`

### Requirement: flow_agent_complete event handling owned by flows-plugin
The plugin's reducer SHALL update the agent's status to `"complete"` or `"error"` based on the result, and store tokens, duration, summary, and files when `flow_agent_complete` is processed.

#### Scenario: Agent completes successfully
- **WHEN** a `flow_agent_complete` event with `{ agentName: "researcher", result: { success: true, status: "complete", tokens: { input: 3000, output: 1000 }, duration: 12000 } }` is processed
- **THEN** the agent's status SHALL be `"complete"` with the token and duration values

### Requirement: flow tool call event handling owned by flows-plugin
The plugin's reducer SHALL append `flow_tool_call` and `flow_tool_result` events to the agent's `toolHistory` array and update the `recentTools` list (last 3 tool calls).

#### Scenario: Tool call recorded
- **WHEN** a `flow_tool_call` event with `{ agentName: "researcher", toolName: "read", input: { path: "src/foo.ts" } }` is processed
- **THEN** the agent's `toolHistory` SHALL include the entry and `recentTools` SHALL show "read · src/foo.ts"

### Requirement: flow_assistant_text and flow_thinking_text event handling owned by flows-plugin
The plugin's reducer SHALL append `flow_assistant_text` and `flow_thinking_text` events to the agent's `detailHistory` array for display in the agent detail view.

#### Scenario: Assistant text recorded
- **WHEN** a `flow_assistant_text` event with `{ agentName: "researcher", text: "I found..." }` is processed
- **THEN** the agent's `detailHistory` SHALL include a text entry

### Requirement: flow_loop_iteration event handling owned by flows-plugin
The plugin's reducer SHALL update the target agent's `loopIteration` and `loopMax` values when `flow_loop_iteration` is processed.

#### Scenario: Loop iteration tracked
- **WHEN** a `flow_loop_iteration` event with `{ loopTarget: "developer", iteration: 2, maxIterations: 3 }` is processed
- **THEN** the `developer` agent SHALL have `loopIteration: 2` and `loopMax: 3`

### Requirement: flow_complete event handling owned by flows-plugin
The plugin's reducer SHALL update the status of the plugin-owned flow slice to the result status and store the `FlowResult` data for the summary view when `flow_complete` is processed. A `flow_complete` whose status is `"rejected"` (a start the flow engine refused, emitted without any `flow_started`) SHALL NOT alter the current flow slice: its status, agents, and result SHALL stay unchanged, and a running flow SHALL remain running.

#### Scenario: Flow completes
- **WHEN** a `flow_complete` event with `{ status: "success", flowName: "research", results: {...} }` is processed
- **THEN** the plugin flow slice status SHALL be `"success"` and its `flowResult` SHALL contain the results

#### Scenario: Rejected start leaves a running flow running
- **GIVEN** flow `research` is running
- **WHEN** a `flow_complete` event with `{ status: "rejected", flowName: "research", reason: "A flow is already running" }` is processed
- **THEN** the plugin flow slice status SHALL still be `"running"` and no agent card status SHALL change

#### Scenario: Rejected start with no current flow
- **GIVEN** no flow slice exists for the session
- **WHEN** a `flow_complete` event with `{ status: "rejected" }` is processed
- **THEN** no flow slice SHALL be created

### Requirement: flow_agent_error event handling owned by flows-plugin
The plugin's reducer SHALL handle `flow_agent_error` by appending an `{ kind: "error", text }` entry to the targeted agent's `detailHistory` array, locating the agent by `agentName`/`stepId`. The `error` variant of `FlowDetailEntry` already exists; this requirement adds its producer case. The reducer SHALL NOT change the agent's status (status is owned by `flow_agent_complete`). Events with empty `text` SHALL be ignored.

#### Scenario: Agent error recorded in timeline
- **WHEN** a `flow_agent_error` event with `{ agentName: "researcher", stepId: "research", text: "tool quota exceeded" }` is processed
- **THEN** the agent's `detailHistory` SHALL include an `{ kind: "error", text: "tool quota exceeded" }` entry

#### Scenario: Empty error text ignored
- **WHEN** a `flow_agent_error` event with empty `text` is processed
- **THEN** the agent's `detailHistory` SHALL be unchanged

#### Scenario: Error replays identically from persisted entries
- **WHEN** a persisted `flow-event` record with `eventType: "flow_agent_error"` is replayed on reload
- **THEN** the reducer SHALL rebuild the same `{ kind: "error", text }` timeline entry as the live path produced

### Requirement: Plugin disable does not crash the dashboard
If the dashboard is configured with the `flows-plugin` disabled (`plugins.flows.enabled = false`) or if the plugin fails to load, its bridge entry SHALL be deregistered, so no `flow:*` channel is declared and no `flow_*` event SHALL be forwarded from the session. The dashboard SHALL NOT throw, no flow UI SHALL render, and persisted `flow-event` entries SHALL stay hidden on replay (no `flow_*` event, no generic custom card).

#### Scenario: Plugin disabled, no UI rendered
- **WHEN** `plugins.flows.enabled = false` and pi-flows emits `flow:flow-started`
- **THEN** the dashboard SHALL not throw
- **AND** no `flow_started` event SHALL be forwarded
- **AND** no `FlowDashboard`, `FlowActivityBadge`, `FlowSummary`, or `FlowAgentDetail` SHALL render in the DOM

#### Scenario: Plugin disabled, persisted runs hidden
- **WHEN** `plugins.flows.enabled = false` and a session with persisted `flow-event` entries is replayed
- **THEN** no `flow_*` event SHALL be emitted and no custom card SHALL render for those entries

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
- **THEN** no `flow.set-edit-mode` `plugin_action` SHALL be sent for that session (the reconcile is removed; this scenario name is kept for delta continuity)

### Requirement: Flow types are owned by the flows plugin
`FlowState`, `FlowAgentState`, `FlowAgentStatus`, `FlowAgentCardConfig` and `NodeKind` SHALL be defined in the flows plugin, not in `packages/shared`. `SessionState` SHALL NOT carry a flow field; the plugin SHALL keep its per-session flow slice through its registered session-event reducer on the client and its server state store.

#### Scenario: Shared types carry no flow type
- **WHEN** `packages/shared/src/types.ts` is inspected
- **THEN** it SHALL NOT export `FlowState`, `FlowAgentState`, `FlowAgentCardConfig` or `NodeKind`

#### Scenario: Plugin slice holds the flow state
- **WHEN** a `flow_started` event is reduced for a session
- **THEN** the flow state SHALL be readable from the flows plugin slice for that session
- **AND** `SessionState` SHALL have no flow field

### Requirement: Fan-out items render as a group with one card per item
The reducer SHALL key a lifecycle event that carries `itemIndex` as `<stepId>[<i>]` under a group for `stepId`; the pre-listed step card SHALL become the group parent. A later item start SHALL NOT count as a rerun of the step.

#### Scenario: Three items produce three item cards
- **WHEN** `flow_agent_started` arrives for `stepId: "review"` with `itemIndex` 0, 1 and 2
- **THEN** the group `review` SHALL hold item cards `review[0]`, `review[1]`, `review[2]`
- **AND** no item SHALL be marked as a rerun

### Requirement: Item-indexed events target the item card
Every flow event carrying `itemIndex` (`flow_agent_started`, `flow_agent_complete`, `flow_agent_error`, `flow_tool_call`, `flow_tool_result`, `flow_assistant_text`, `flow_thinking_text`) SHALL target the item card `<stepId>[<i>]`. The same event without `itemIndex` SHALL target the step card, which is the group parent for a fan-out step. A `flow_agent_error` with `itemIndex` SHALL append to that item's `detailHistory` and SHALL NOT change the item's status.

#### Scenario: Tool call and text land on the item card
- **GIVEN** group `review` with item cards `review[0]` and `review[1]`
- **WHEN** `flow_tool_call`, `flow_assistant_text` and `flow_thinking_text` arrive for `stepId: "review"` with `itemIndex: 1`
- **THEN** they SHALL be recorded on `review[1]` only
- **AND** neither `review[0]` nor the group parent SHALL change

#### Scenario: Tool result and completion land on the item card
- **WHEN** `flow_tool_result` then `flow_agent_complete` arrive for `stepId: "review"` with `itemIndex: 0`
- **THEN** both SHALL update `review[0]` only

#### Scenario: Event without itemIndex targets the step
- **WHEN** `flow_assistant_text` arrives for `stepId: "review"` without `itemIndex`
- **THEN** it SHALL be recorded on the `review` step card (the group parent)

#### Scenario: Item error appends to detailHistory without status change
- **GIVEN** item card `review[2]` is `running`
- **WHEN** `flow_agent_error` arrives for `stepId: "review"` with `itemIndex: 2`
- **THEN** the error SHALL be appended to the `detailHistory` of `review[2]`
- **AND** `review[2]` SHALL still be `running`

### Requirement: Fan-out group parent status and rollup
A fan-out group parent status SHALL follow this precedence, first match wins: any item `running` or started but still `pending` gives `running`; else any item `error` gives `error`, with outcome `hard` if any item failed hard, else `soft`; else any item `blocked` gives `blocked`; else all items `skipped`, or zero items, gives `skipped`; else `complete`. The parent SHALL expose an ok / failed rollup count.

#### Scenario: Failed item is not hidden by a later success
- **GIVEN** group `review` with items 0 and 1
- **WHEN** item 0 completes with a soft failure and item 1 then completes successfully
- **THEN** the parent status SHALL be `error` with outcome `soft` and its rollup SHALL read 1 ok, 1 failed

#### Scenario: Running item keeps the parent running
- **WHEN** one item of a group is `running` and another has failed
- **THEN** the parent status SHALL be `running`

#### Scenario: Mixed hard and soft failures yield a hard error
- **GIVEN** group `review` with items 0 and 1, none running
- **WHEN** item 0 fails soft and item 1 fails hard
- **THEN** the parent status SHALL be `error` with outcome `hard`

#### Scenario: Blocked item without errors blocks the parent
- **WHEN** no item of a group is running or failed and one item is `blocked`
- **THEN** the parent status SHALL be `blocked`

#### Scenario: Zero items yields skipped
- **WHEN** a fan-out step finishes with zero items
- **THEN** the parent status SHALL be `skipped` and its rollup SHALL read 0 ok, 0 failed

#### Scenario: All items complete yields complete
- **WHEN** every item of a group completed successfully
- **THEN** the parent status SHALL be `complete`

### Requirement: flow_decision event handling owned by flows-plugin
The reducer SHALL handle `flow_decision` by storing `{ labels, routes, routeError }` on the decision step card. Without a `routeError` it SHALL mark every branch target of that decision that was not chosen `skipped`; on loop re-entry it SHALL overwrite stale results as `skipped` only for targets in that decision's own group. With a `routeError` it SHALL mark nothing `skipped`, and the decision card SHALL show the error.

#### Scenario: Chosen routes stored and unchosen targets skipped
- **GIVEN** decision step `triage` with branch targets `fix` and `doc`
- **WHEN** `flow_decision` arrives for `triage` with `routes` naming only `fix`
- **THEN** the `triage` card SHALL store the labels and routes
- **AND** the `doc` card SHALL be `skipped`

#### Scenario: Loop re-entry overwrites stale results
- **GIVEN** `doc` completed in an earlier loop iteration
- **WHEN** a new `flow_decision` for `triage` does not choose `doc`
- **THEN** the `doc` card SHALL read `skipped`

#### Scenario: Loop re-entry leaves other groups alone
- **GIVEN** decision `triage` has targets `fix` and `doc`, and step `report` (not a target of `triage`) completed earlier
- **WHEN** a new `flow_decision` for `triage` chooses `fix`
- **THEN** `report` SHALL keep its `complete` status

#### Scenario: Route error stored
- **WHEN** `flow_decision` carries a `routeError`
- **THEN** the decision card SHALL store and expose that `routeError`

#### Scenario: Route error marks nothing skipped
- **GIVEN** decision step `triage` with branch targets `fix` and `doc`, both `pending`
- **WHEN** `flow_decision` arrives for `triage` with a `routeError` and no routes
- **THEN** neither `fix` nor `doc` SHALL be `skipped`
- **AND** the `triage` card SHALL show the error text

### Requirement: Skipped status is never downgraded by flow_complete
`FlowAgentStatus` SHALL include `skipped`. On a non-success `flow_complete`, the reducer SHALL NOT change a `skipped` card's status.

#### Scenario: Skipped step survives a failed flow
- **GIVEN** step `doc` is `skipped`
- **WHEN** `flow_complete` arrives with `status: "error"`
- **THEN** `doc` SHALL still read `skipped`

### Requirement: Graph labels skipped, fan-out and decision nodes
The flow graph SHALL render a skipped node in the pending style plus the word `skipped` (colour SHALL NOT be the sole channel), SHALL add an `xN (k failed)` count to a fan-out node, and SHALL show the chosen routes on a decision node.

#### Scenario: Fan-out node shows item count
- **WHEN** group `review` has 3 items and 1 failed
- **THEN** the `review` graph node SHALL show `x3 (1 failed)`

#### Scenario: Skipped node labelled in words
- **WHEN** step `doc` is `skipped`
- **THEN** its graph node SHALL show the text `skipped`

#### Scenario: Decision node shows chosen routes
- **WHEN** `triage` chose route `fix`
- **THEN** the `triage` graph node SHALL show `fix` as its chosen route

### Requirement: Static YAML preview keeps object-form branches
The static flow YAML parser SHALL accept object-form branch targets (`{ to, means }`, `{ to, for_each }`) in addition to string targets, and SHALL produce an edge to each `to` target.

#### Scenario: Object-form branch kept
- **WHEN** a flow YAML declares a branch `{ to: "fix", means: "bug found" }`
- **THEN** the static preview graph SHALL include an edge to `fix`

### Requirement: Flow commands travel as plugin_action
The flows plugin server SHALL handle `plugin_action { pluginId: "flows", action }` for exactly six actions: `flow.abort`, `flow.toggle-autonomous`, `flow.dismiss-summary`, `flow.run`, `flow.delete` and `flow.set-edit-mode`, relaying fixed event names into the target session through `ctx.emitEventToSession`. An unknown action SHALL be logged and dropped. An invalid payload SHALL emit nothing. A session whose driver is `acp` SHALL be refused with `UNSUPPORTED_FOR_ACP` before any relay.

#### Scenario: Abort emits both abort events
- **WHEN** the server receives `flow.abort` for a session
- **THEN** it SHALL emit `flow:abort` and `flow:architect-abort` into that session

#### Scenario: Toggle autonomous
- **WHEN** the server receives `flow.toggle-autonomous`
- **THEN** it SHALL emit `flow:toggle-autonomous`

#### Scenario: Dismiss summary
- **WHEN** the server receives `flow.dismiss-summary`
- **THEN** it SHALL emit `flow:summary-dismissed`

#### Scenario: Delete emits request and notify
- **WHEN** the server receives `flow.delete` with a valid `flowName`
- **THEN** it SHALL emit `flow:delete-request` and `flow:notify`

#### Scenario: Run keeps its existing relay
- **WHEN** the server receives `flow.run` with a valid `flowName` and `task`
- **THEN** it SHALL emit `flow:run { flowName, task }`

#### Scenario: Set edit-mode accepts a boolean only
- **WHEN** the server receives `flow.set-edit-mode` with `enabled: true` while the project's edit mode is off
- **THEN** it SHALL emit `flow:set-edit-mode { enabled: true }`; a request equal to the current mode SHALL emit nothing

#### Scenario: Non-boolean edit-mode ignored
- **WHEN** the server receives `flow.set-edit-mode` whose `enabled` is not a boolean
- **THEN** it SHALL emit nothing

#### Scenario: Invalid flowName rejected
- **WHEN** `flow.delete` or `flow.run` carries a `flowName` that is not a valid flow id
- **THEN** the server SHALL emit nothing and SHALL report the action as rejected

#### Scenario: Unknown action logged and dropped
- **WHEN** the server receives `plugin_action { pluginId: "flows", action: "flow.rename" }`
- **THEN** it SHALL log the unknown action
- **AND** it SHALL emit nothing into the session

#### Scenario: ACP session refused before relay
- **GIVEN** a session whose driver is `acp`
- **WHEN** the server receives `flow.abort` for that session
- **THEN** it SHALL answer `UNSUPPORTED_FOR_ACP`
- **AND** it SHALL emit no event into that session

### Requirement: Flows manifest emits lists every relayed event
The flows plugin manifest `emits` list SHALL name every event the plugin server relays through `ctx.emitEventToSession`: `flow:run`, `flow:set-edit-mode`, `flow:abort`, `flow:architect-abort`, `flow:toggle-autonomous`, `flow:summary-dismissed`, `flow:delete-request` and `flow:notify`, so the loader's emits gate allows each relay.

#### Scenario: Every relayed event is declared
- **WHEN** the flows plugin manifest is loaded
- **THEN** its `emits` list SHALL contain `flow:run`, `flow:set-edit-mode`, `flow:abort`, `flow:architect-abort`, `flow:toggle-autonomous`, `flow:summary-dismissed`, `flow:delete-request` and `flow:notify`

#### Scenario: Abort relay is not blocked by the emits gate
- **WHEN** the server handles `flow.abort` for a pi session
- **THEN** both `flow:abort` and `flow:architect-abort` SHALL reach the session

### Requirement: Flow control plugin route
The flows plugin SHALL expose `POST /api/plugins/flows/control` with body `{ sessionId, action, flowName?, task?, enabled? }`, accepting the same six actions as the `plugin_action` path with the same validation and relays. The route SHALL require operate authority and the network guard. For a session whose driver is `acp` it SHALL answer `UNSUPPORTED_FOR_ACP` before any relay.

#### Scenario: Abort over REST
- **WHEN** an operator posts `{ sessionId, action: "flow.abort" }` to `/api/plugins/flows/control`
- **THEN** the plugin SHALL emit `flow:abort` and `flow:architect-abort` into that session and respond with success

#### Scenario: Run over REST
- **WHEN** an operator posts `{ sessionId, action: "flow.run", flowName: "research", task: "Find bugs" }`
- **THEN** the plugin SHALL emit `flow:run { flowName: "research", task: "Find bugs" }` into that session

#### Scenario: Edit mode over REST
- **WHEN** an operator posts `{ sessionId, action: "flow.set-edit-mode", enabled: false }` while the project's edit mode is on
- **THEN** the plugin SHALL emit `flow:set-edit-mode { enabled: false }` into that session

#### Scenario: Unknown action refused over REST
- **WHEN** an operator posts `{ sessionId, action: "flow.rename" }`
- **THEN** the route SHALL refuse the request and emit nothing

#### Scenario: Missing operate authority refused
- **WHEN** a caller without operate authority posts to the route
- **THEN** the route SHALL refuse the request and emit nothing

#### Scenario: ACP session unsupported
- **WHEN** the target `sessionId` is a session whose driver is `acp`
- **THEN** the route SHALL answer `UNSUPPORTED_FOR_ACP` and emit nothing

### Requirement: Flows plugin publishes a tool facade for flow code nodes

While the flows plugin is enabled, its bridge SHALL publish a facade over the dashboard tool registry on the process-global slot `Symbol.for("pi-dashboard.flow-tools")` for pi-flows code-node handlers in the same pi process. It SHALL publish on activation and on every `session_start`, SHALL clear the slot on `session_shutdown`, and SHALL never throw. pi-flows' `CodeNodeContext` and the registry's tool definitions SHALL NOT change.

#### Scenario: Facade published on activation
- **WHEN** the flows plugin bridge activates in a pi session
- **THEN** the `pi-dashboard.flow-tools` slot holds the facade before any flow runs

#### Scenario: Facade absent without the flows plugin
- **WHEN** a pi session runs with the flows plugin disabled or without the dashboard
- **THEN** the `pi-dashboard.flow-tools` slot is unset, so a guarded handler takes its own fallback path

#### Scenario: No stale facade after reload with the plugin disabled
- **WHEN** the facade was published, then the session shuts down for `/reload` and the flows plugin bridge is not registered afterwards
- **THEN** the `pi-dashboard.flow-tools` slot is unset

### Requirement: Facade resolves any registered tool by name

The facade SHALL accept any tool name registered in the dashboard tool registry, not a fixed subset, and SHALL NOT offer an operation that resolves every tool at once. `has(name)` SHALL report whether `name` is registered. `resolve(name)` SHALL return the tool's resolved absolute filesystem path, or `null` when the tool is unregistered, does not resolve, has no absolute path, or resolution fails. None of them SHALL throw.

#### Scenario: Any registered tool name is accepted
- **WHEN** a handler calls `has("git")`, `has("node")` and `has("bash")`
- **THEN** each returns `true`, and `resolve` of each returns an absolute path when that tool is installed

#### Scenario: Unknown tool resolves to null
- **WHEN** a handler calls `resolve("not-a-registered-tool")`
- **THEN** it returns `null` and does not throw

### Requirement: Facade runs registered tools without throwing

`run(name, args, opts)` SHALL execute the registry's ready-to-spawn command for `name` (with any interpreter prefix) plus `args`, honouring `opts.cwd`, `opts.env`, `opts.timeoutMs` and `opts.signal`, with no console window on Windows. It SHALL resolve to `{ ok, code, stdout, stderr, out }` and never throw or reject. An unresolved tool SHALL yield `ok: false, code: 127` without spawning, and an already-aborted signal SHALL yield `ok: false, code: 130` without spawning.

#### Scenario: Registered tool runs
- **WHEN** a handler calls `run("git", ["--version"])`
- **THEN** it resolves with `ok: true` and `out` containing `git version`

#### Scenario: Unregistered tool fails soft
- **WHEN** a handler calls `run("not-a-registered-tool")`
- **THEN** it resolves with `ok: false` and `code: 127`
- **AND** no process is spawned and nothing is thrown

#### Scenario: Abort stops a running tool
- **WHEN** a handler passes `opts.signal` to `run` and the signal aborts while the tool is running
- **THEN** the child is terminated and the call resolves with `ok: false` instead of hanging

#### Scenario: Already-aborted signal spawns nothing
- **WHEN** a handler calls `run` or `shell` with a signal that is already aborted
- **THEN** the call resolves immediately with `ok: false` and `code: 130`, and no process is spawned

#### Scenario: Timeout stops the tool and its children
- **WHEN** a handler calls `shell("sleep 30 & wait", { timeoutMs: 500 })`
- **THEN** the call resolves with `ok: false` within 2 s of the timeout elapsing
- **AND** no process spawned by that call is still running

#### Scenario: Non-executable tool fails soft
- **WHEN** a handler calls `run` for a registered tool whose resolution is not an executable (for example a module directory)
- **THEN** the call resolves with `ok: false` and does not throw

### Requirement: Facade run and shell stop runaway children

For `run` and `shell`, a timeout (`opts.timeoutMs` that is a positive finite number) or a mid-run abort SHALL terminate the child and every process it spawned, and the call SHALL resolve with `ok: false` within 2 s of the timeout elapsing or the abort. Each of stdout and stderr SHALL be capped at a fixed 64 MiB. Exceeding the cap SHALL terminate the child the same way and resolve `ok: false` with the output captured up to the cap.

#### Scenario: Output beyond the cap is cut off
- **WHEN** a handler calls `shell` with a script that writes more than 64 MiB to stdout
- **THEN** the call resolves with `ok: false` within 2 s of crossing the cap, with `stdout` no longer than 64 MiB

#### Scenario: Non-positive timeout means no timeout
- **WHEN** a handler calls `shell("sleep 1", { timeoutMs: 0 })`
- **THEN** the call resolves with `ok: true` after the command completes

### Requirement: Facade shell runs bash without login profiles

`shell(script, opts)` SHALL run `script` with the registry-resolved `bash` without loading login or rc profiles, and without an inherited `BASH_ENV` / `ENV` unless the caller sets one in `opts.env`. It takes the same options and returns the same result shape as `run`, and it SHALL never throw or reject. If `bash` does not resolve, it SHALL resolve to `ok: false, code: 127`.

#### Scenario: Shell output is free of profile noise
- **WHEN** a handler calls `shell("echo hi")` on a host whose login profile prints to stderr and whose environment sets `BASH_ENV` to a script that prints
- **THEN** the result has `ok: true`, `stdout` of `hi`, and no profile or `BASH_ENV` output in `stderr`

#### Scenario: Managed-dir tools are found by shell
- **WHEN** a tool exists only in the dashboard's managed bin dir and a handler calls `shell("<tool> --version")`
- **THEN** the call resolves with `ok: true`

### Requirement: flow_write carries dashboard-only guidance for the facade

While the flows plugin is enabled, its bridge SHALL, before each agent run whose selected tools include `flow_write`, append exactly one guideline to `flow_write`'s prompt guidelines. The guideline SHALL include a literal guard snippet for obtaining the facade from the `pi-dashboard.flow-tools` slot with a fallback branch, and SHALL name the facade's methods and result shape. Failures while appending SHALL never block the run.

#### Scenario: Guideline added when flow_write is selected
- **WHEN** an agent run starts with `flow_write` among its selected tools
- **THEN** the `flow_write` guidelines contain the facade guideline exactly once, even if the hook runs more than once for that run

#### Scenario: No guideline when flow_write is not selected
- **WHEN** an agent run starts without `flow_write` among its selected tools (flow edit mode off)
- **THEN** no facade guideline is added for any tool

#### Scenario: No guideline without the flows plugin
- **WHEN** the flows plugin is disabled, so its bridge is not registered
- **THEN** `flow_write` carries only pi-flows' own description and guidelines
