## ADDED Requirements

### Requirement: Popout button on every flow agent card

Every `FlowAgentCard` rendered inside `FlowDashboard` SHALL include a popout button (`mdi-open-in-new` icon) in its header-right cluster, adjacent to the existing eye/detail button. Clicking the button SHALL open `/session/:sid/flow/:flowId/agent/:agentId` in a new browser tab via `window.open(url, "_blank")`, where `:sid` is the parent session id, `:flowId` is the agent's flow name (URL-encoded), and `:agentId` is the agent's `stepId`.

#### Scenario: Popout button visible on each card

- **WHEN** `FlowDashboard` renders agent cards for an active flow
- **THEN** each `FlowAgentCard` SHALL render a popout button alongside its existing controls

#### Scenario: Click opens new tab to the popout URL

- **WHEN** the user clicks the popout button on an agent card with `sessionId="sess_1"`, flow name `"my-pipeline"`, and `stepId="agent_3"`
- **THEN** a new tab SHALL open at the URL `/session/sess_1/flow/my-pipeline/agent/agent_3`

#### Scenario: URL encoding for flow names with reserved characters

- **WHEN** the flow name is `"my flow: v2"` and the popout button is clicked
- **THEN** the opened URL SHALL apply `encodeURIComponent` to the flow name segment (e.g. `/session/sess_1/flow/my%20flow%3A%20v2/agent/agent_3`)

#### Scenario: Popout button disabled when required identifiers are missing

- **WHEN** a `FlowAgentCard` is rendered without `sessionId` or without `flowId` props
- **THEN** the popout button SHALL render in a disabled state and clicking it SHALL NOT open a new tab

### Requirement: Flows plugin claims the popout route via `shell-overlay-route`

The flows-plugin manifest SHALL declare a `shell-overlay-route` claim with `component: "FlowAgentPopoutClaim"`, `config.path: "/session/:sid/flow/:flowId/agent/:agentId"`, and `config.sessionParam: "sid"`. The exported `FlowAgentPopoutClaim` component SHALL be the entry point — the dashboard shell SHALL NOT import any flow popout component directly.

#### Scenario: Manifest declares the claim

- **WHEN** the plugin loader validates `packages/flows-plugin/package.json`'s `pi-dashboard-plugin.claims`
- **THEN** exactly one claim SHALL have slot `"shell-overlay-route"` AND component `"FlowAgentPopoutClaim"`
- **AND** the claim's `config.path` SHALL equal `"/session/:sid/flow/:flowId/agent/:agentId"`

#### Scenario: Shell has no direct import of FlowAgentPopoutPage

- **WHEN** static analysis inspects `packages/client/src/App.tsx`
- **THEN** the file SHALL NOT contain an import of `FlowAgentPopoutPage`, `FlowAgentPopoutClaim`, or any other flow popout component from `@blackbelt-technology/pi-dashboard-flows-plugin`

### Requirement: FlowAgentPopoutClaim is self-contained

`FlowAgentPopoutClaim` SHALL self-derive everything it needs from the slot's props (`{ params, session, onBack, pluginContext }`) plus the plugin's own state hooks. Specifically:

- It SHALL read `params.sid`, `params.flowId` (after `decodeURIComponent`), and `params.agentId` from the slot props.
- It SHALL read the parent session's flow state via `useFlowsSessionState(params.sid)`.
- It SHALL cold-open subscribe to the parent session via `usePluginSend({ type: "subscribe", sessionId: params.sid, lastSeq: 0 })` exactly once on mount (idempotent on the server).
- It SHALL look up `flowStates.get(decodedFlowId)` and `flow.agents.get(params.agentId)` to resolve the targeted agent.
- It SHALL render `FlowAgentPopoutPage` with the resolved `{ flow, agent, session, onBack }`.

#### Scenario: Claim reads flow state from plugin context

- **WHEN** `FlowAgentPopoutClaim` mounts with `params.sid = "sess_1"`
- **THEN** it SHALL call `useFlowsSessionState("sess_1")` to read flow state
- **AND** it SHALL NOT reach for `sessionStates` or any other shell-owned state map

#### Scenario: Claim subscribes on cold open

- **WHEN** the popout URL is opened in a fresh tab and the parent session has not been subscribed
- **THEN** the claim SHALL emit `{ type: "subscribe", sessionId: <sid>, lastSeq: 0 }` via `usePluginSend` exactly once on mount

### Requirement: Popout page renders flow agent timeline in fullscreen

`FlowAgentPopoutPage` SHALL render `FlowAgentDetail` for the targeted agent inside the page body, with the page's chrome header providing back-navigation and breadcrumb (`session › flow name › agent name`). `FlowAgentDetail`'s own back button SHALL be suppressed by passing no `onBack` prop (popout chrome owns navigation).

#### Scenario: Popout body uses FlowAgentDetail

- **WHEN** the popout page resolves the targeted agent
- **THEN** the page body SHALL render `<FlowAgentDetail agent={...} />` displaying the agent's full timeline

#### Scenario: Popout chrome header shows breadcrumb

- **WHEN** the popout page renders for a resolved agent
- **THEN** the chrome header SHALL show the parent-session label (cwd), the flow name, and the agent's display name in breadcrumb order, plus a back button

#### Scenario: Document title updates while popout is mounted

- **WHEN** the popout page is mounted for an agent with display name `"reviewer"` in flow `"my-pipeline"` under session cwd `"my-repo"`
- **THEN** `document.title` SHALL be set to `"reviewer · my-pipeline · my-repo · pi"` while the page is mounted and SHALL be restored to `"pi"` on unmount

### Requirement: Popout page handles four empty-state branches

The popout page SHALL render one of four empty-state branches when the targeted agent cannot be displayed, evaluated in the following order:

1. Subscription not yet resolved → "Loading parent session…"
2. Parent session metadata not found (via `useShellSession`) → "Parent session not found — close tab"
3. Targeted flow not present in `flowStates` → "Flow not found"
4. Targeted agent not present in `flow.agents` → "Agent not found in this flow"

#### Scenario: Subscription still pending

- **WHEN** the popout claim mounts cold and the parent session's subscription has not been acknowledged
- **THEN** the page SHALL render the "Loading parent session…" state

#### Scenario: Parent session not found

- **WHEN** the subscription has resolved but `useShellSession(sid)` returns `undefined`
- **THEN** the page SHALL render an empty state explaining the session is no longer available, with a button to close the tab

#### Scenario: Flow not found

- **WHEN** session metadata is present but `flowStates.get(flowId)` is `undefined`
- **THEN** the page SHALL render an empty state with the text "Flow not found"

#### Scenario: Agent not found in flow

- **WHEN** the flow is present but `flow.agents.get(agentId)` is `undefined`
- **THEN** the page SHALL render an empty state with the text "Agent not found in this flow"

### Requirement: Popout coexists with the eye-button popover

The existing eye-button popover on `FlowAgentCard` (which opens `FlowAgentDetail` anchored to the card) SHALL remain unchanged. Both surfaces SHALL be operable independently — opening the popover SHALL NOT close any open popout tab, and vice versa.

#### Scenario: Eye-button popover still works

- **WHEN** the user clicks the eye button on an agent card
- **THEN** the existing `FlowAgentDetail` popover SHALL open anchored to the card, regardless of whether a popout tab is open for the same agent

#### Scenario: Popout tab survives parent-session navigation

- **WHEN** a popout tab is open at `/session/:sid/flow/:flowId/agent/:agentId` and the user navigates away from the parent session in the original tab
- **THEN** the popout tab SHALL continue rendering the agent timeline, driven by its own subscription
