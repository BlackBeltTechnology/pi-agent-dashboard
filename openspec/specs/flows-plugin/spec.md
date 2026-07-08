# flows-plugin Specification

## Purpose

Flow rendering for the pi-dashboard, packaged as a dedicated workspace plugin (`packages/flows-plugin/`). Owns the `FlowState` lifecycle on the client — the reducer arms for every `flow_*` event — and claims dashboard plugin slots that mount its UI (`FlowDashboard`, `FlowActivityBadge`, `FlowSummary`, `FlowAgentDetail`).

`SessionState.flowState` remains a typed field on the central `SessionState` (declared in `packages/shared/src/types.ts`) so both the plugin and the core client can reference it without an import cycle. The core `event-reducer.ts` continues to dispatch `flow_*` events, but the per-event reducer logic and the rendered UI are owned by this capability.

The motivating design lives in `openspec/changes/extract-flows-as-plugin/design.md`.
## Requirements
### Requirement: Flow rendering is packaged as a workspace plugin
The dashboard SHALL ship flow rendering as a dedicated workspace package at `packages/flows-plugin/`. The package SHALL declare a `pi-dashboard-plugin` manifest field claiming the slots that mount its UI components, and SHALL expose its reducer logic via an `exports` map so that `packages/client/src/lib/event-reducer.ts` can import it as a workspace dependency.

#### Scenario: Workspace dependency wired
- **WHEN** the dashboard is built from a fresh checkout
- **THEN** `packages/client/package.json` SHALL list `@blackbelt-technology/pi-dashboard-flows-plugin` as a dependency
- **AND** `packages/flows-plugin/package.json` SHALL include a `pi-dashboard-plugin` manifest field
- **AND** the manifest SHALL claim at minimum: `session-card-badge`, `session-card-action-bar`, `content-header-sticky`, `content-view` (route `flow-agent-detail/:agentId`), `content-view` (route `architect-detail`), `content-inline-footer`

### Requirement: Flow state tracked in SessionState
The `SessionState` SHALL include a `flowState` field of type `FlowState | null`. `FlowState` SHALL contain: `flowName`, `task`, `status` (running/success/error/aborted), `autonomousMode`, `agents` (ordered map of agent name → `FlowAgentState`), and `flowResult` (set on completion). The type definition SHALL live in `packages/shared/src/types.ts` so both the plugin and the core client can reference it without an import cycle.

#### Scenario: Initial state has no flow
- **WHEN** `createInitialState()` is called in the core reducer
- **THEN** `flowState` SHALL be `null`

### Requirement: flow_started event handling owned by flows-plugin
The `flows-plugin` package SHALL export a reducer function that handles `flow_started` by creating a new `FlowState` with the flow name, task, status `"running"`, and pre-populated agent entries (from the `steps` array) in pending status with their `blockedBy` dependencies. `event-reducer.ts` SHALL invoke this reducer when a `flow_started` event arrives.

#### Scenario: Flow started creates flow state
- **WHEN** a `flow_started` event with `{ flowName: "research", task: "Find bugs", steps: [{id: "r", agent: "researcher", blockedBy: []}, {id: "d", agent: "developer", blockedBy: ["r"]}] }` is processed
- **THEN** `flowState` SHALL be set with `flowName: "research"`, two agents in pending status, and `developer` SHALL have `blockedBy: ["r"]`

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
The plugin's reducer SHALL update `flowState.status` to the result status and store the `FlowResult` data for the summary view when `flow_complete` is processed.

#### Scenario: Flow completes
- **WHEN** a `flow_complete` event with `{ status: "success", flowName: "research", results: {...} }` is processed
- **THEN** `flowState.status` SHALL be `"success"` and `flowState.flowResult` SHALL contain the results

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
If the dashboard is configured with the `flows-plugin` disabled (`plugins.flows.enabled = false`) or if the plugin fails to load, `flow_*` events arriving from pi-flows SHALL be processed harmlessly: either the reducer code is still resident (compile-time imported) and updates `flowState`, or the events are no-ops. In neither case SHALL the dashboard throw, and in neither case SHALL any flow UI render.

#### Scenario: Plugin disabled, no UI rendered
- **WHEN** `plugins.flows.enabled = false` and a `flow_started` event arrives
- **THEN** the dashboard SHALL not throw
- **AND** no `FlowDashboard`, `FlowActivityBadge`, `FlowSummary`, or `FlowAgentDetail` SHALL render in the DOM

### Requirement: FLOWS subcard availability is gated on extension presence, not flow count

The flows-plugin's `shouldRenderFlowsSubcard` predicate (manifest `session-card-flows` claim) SHALL report the FLOWS subcard as available when the pi-flows extension is active in the session's cwd — detected by a flows-namespaced command in the session's `commandsList` (pi-flows registers `/flows` plus `flows:*` in every session it loads into) — OR when the session has any flow event (live or replayed). It SHALL NOT gate on `flowsList` length, so a cwd where pi-flows is active but no flows are authored yet still shows the subcard (the author-first-flow / edit-mode case). The removed `flows:new` command SHALL NOT be used as a signal.

The availability cache SHALL remain closed-by-default (returns `false` until the first `commandsList` publish for the session) to avoid cold-boot flicker, and SHALL recompute on `commandsList` / `flowsList` publishes via the existing module-level subscriber.

#### Scenario: Active-but-empty flows cwd shows the subcard
- **WHEN** a session's `commandsList` contains a command named `flows` (pi-flows active) and its `flowsList` is empty
- **THEN** `shouldRenderFlowsSubcard(session)` SHALL return `true`

#### Scenario: Any flows-namespaced command counts as presence
- **WHEN** a session's `commandsList` contains a command whose name starts with `flows:` (e.g. `flows:delete`)
- **THEN** `shouldRenderFlowsSubcard(session)` SHALL return `true`

#### Scenario: No flows command hides the subcard even if flows are listed
- **WHEN** a session has a non-empty `flowsList` but no `flows` / `flows:*` command in `commandsList`
- **THEN** `shouldRenderFlowsSubcard(session)` SHALL return `false`

#### Scenario: A run keeps the subcard visible
- **WHEN** a session has any `flow_*` event (live or replayed) regardless of its current `commandsList`
- **THEN** `shouldRenderFlowsSubcard(session)` SHALL return `true`

#### Scenario: Closed by default before first publish
- **WHEN** no `commandsList` has been published for a session and it has no flow events
- **THEN** `shouldRenderFlowsSubcard(session)` SHALL return `false`

#### Scenario: `flows:new` is not a signal
- **WHEN** availability is computed for a session
- **THEN** the presence of (or absence of) a `flows:new` command SHALL NOT affect the result (the command was removed upstream)

### Requirement: Flows registers automation actions

The flows plugin SHALL register `flows.run` as an automation action that dispatches by **emitting a configured event** into the run session (not by seeding a slash-command prompt), gated on flows existing in the cwd. The set of "flows in the cwd" SHALL be the live per-session flows list held by the flows-plugin server (`stateStore`, populated by the bridge-forwarded `flows_list`), resolved by mapping the cwd to its running pi session(s) via the plugin `sessionManager` and unioning their reported flows. The gate SHALL NOT be a static filesystem scan of `<cwd>/.pi/flows/flows/`, so package-bundled and event-registered flows (which pi-flows discovers at runtime) are reflected. `flows.run` SHALL declare a `flow` enum field (options = the same live cwd flows list) and a `task` multiline field. Its `buildEvent` SHALL return `{ eventType: "flow:run", data: { flowName, task } }`; a malformed `flow` id SHALL emit nothing (`null`). The run SHALL finalize on `agent_end`.

When no running pi session exists for the cwd, the live flows list SHALL be empty and `flows.run` SHALL be reported as unavailable (present-but-disabled) for that cwd.

The flows plugin SHALL NOT register `flows.resume` or `flows.cancel` — pi-flows exposes no run-scoped resume/cancel command reachable by the automation dispatch path. Registration SHALL be a no-op (with a warning) when the action registry is absent, and SHALL honor the registry's rejection result.

#### Scenario: flows.run available from live session flows

- **WHEN** a pi session is running for cwd `/w/invoice-bot` and its forwarded `flows_list` contains `invoicebot:pull` (a package/event-registered flow not present under `<cwd>/.pi/flows/flows/`)
- **THEN** `available(cwd)` SHALL return true and the `flow` enum options SHALL include `invoicebot:pull`.

#### Scenario: flows.run unavailable with no live session

- **WHEN** no pi session is running for cwd `/w/invoice-bot`
- **THEN** `available(cwd)` SHALL return false and the dialog SHALL surface `flows.run` as present-but-disabled.

#### Scenario: flows.run emits flow:run

- **WHEN** `flows.run` fires with `payload { flow: "test:x", task: "go" }`
- **THEN** its `buildEvent` SHALL return `{ eventType: "flow:run", data: { flowName: "test:x", task: "go" } }`.

#### Scenario: malformed flow id emits nothing

- **WHEN** `flows.run` fires with a `flow` payload that is not `<ns>:<name>`
- **THEN** its `buildEvent` SHALL return `null` and no event SHALL be emitted.

#### Scenario: resume and cancel are not offered

- **WHEN** the flows plugin registers its actions
- **THEN** neither `flows.resume` nor `flows.cancel` SHALL be present in the registry.

