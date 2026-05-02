## ADDED Requirements

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

### Requirement: Plugin disable does not crash the dashboard
If the dashboard is configured with the `flows-plugin` disabled (`plugins.flows.enabled = false`) or if the plugin fails to load, `flow_*` events arriving from pi-flows SHALL be processed harmlessly: either the reducer code is still resident (compile-time imported) and updates `flowState`, or the events are no-ops. In neither case SHALL the dashboard throw, and in neither case SHALL any flow UI render.

#### Scenario: Plugin disabled, no UI rendered
- **WHEN** `plugins.flows.enabled = false` and a `flow_started` event arrives
- **THEN** the dashboard SHALL not throw
- **AND** no `FlowDashboard`, `FlowActivityBadge`, `FlowSummary`, or `FlowAgentDetail` SHALL render in the DOM
