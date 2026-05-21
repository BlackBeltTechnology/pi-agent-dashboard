# flow-architect-popout Specification

## Purpose
TBD - created by archiving change fix-flows-plugin-polish. Update Purpose after archive.
## Requirements
### Requirement: Flows plugin claims the architect popout route via `shell-overlay-route`

The flows-plugin manifest SHALL declare a `shell-overlay-route` claim
with `component: "FlowArchitectPopoutClaim"`,
`config.path: "/session/:sid/architect"`, and
`config.sessionParam: "sid"`. The exported `FlowArchitectPopoutClaim`
component SHALL be the entry point; the dashboard shell SHALL NOT
import any architect popout component directly.

#### Scenario: Manifest declares the claim

- **WHEN** the plugin loader validates
  `packages/flows-plugin/package.json`'s `pi-dashboard-plugin.claims`
- **THEN** exactly one claim SHALL have slot `"shell-overlay-route"`,
  component `"FlowArchitectPopoutClaim"`, AND
  `config.path` equal to `"/session/:sid/architect"`

#### Scenario: Shell has no direct architect popout import

- **WHEN** static analysis inspects `packages/client/src/App.tsx`
- **THEN** the file SHALL NOT contain an import of
  `FlowArchitectPopoutPage` or `FlowArchitectPopoutClaim`

### Requirement: FlowArchitectPopoutClaim self-derives

`FlowArchitectPopoutClaim` SHALL self-derive everything from the slot
props (`{ params, session, onBack, pluginContext }`) plus the
plugins-internal hooks. Specifically:

- Reads `params.sid` from the URL.
- Cold-open subscribes to the parent session via
  `usePluginSend({ type: "subscribe", sessionId: params.sid, lastSeq: 0 })`
  exactly once on mount.
- Reads architect state via `useFlowsSessionState(params.sid).architectState`.
- Renders `FlowArchitectPopoutPage` with the resolved
  `{ state, session, onBack }`.

#### Scenario: Claim reads architect state from plugin context

- **WHEN** `FlowArchitectPopoutClaim` mounts with `params.sid = "sess_1"`
- **THEN** it SHALL call `useFlowsSessionState("sess_1")` and read
  `architectState` from the result
- **AND** it SHALL NOT reach for `sessionStates` or any other
  shell-owned state map

#### Scenario: Cold-open subscribe fires once

- **WHEN** the architect popout URL is opened in a fresh tab
- **THEN** the claim SHALL dispatch
  `{ type: "subscribe", sessionId: <sid>, lastSeq: 0 }` via
  `usePluginSend` exactly once on mount

### Requirement: FlowArchitectPopoutPage renders the architect in fullscreen

`FlowArchitectPopoutPage` SHALL render the `FlowArchitectDetail`
component (a `MinimalChatView` shim) in popout mode plus a chrome
header carrying back-navigation and a breadcrumb (`session › "Flow
Architect"`).

#### Scenario: Page body is FlowArchitectDetail

- **WHEN** the popout page resolves a non-null `architectState`
- **THEN** the page body SHALL render `<FlowArchitectDetail state={...} />`

#### Scenario: Document title updates while popout is mounted

- **WHEN** the popout page is mounted for session cwd `"my-repo"`
- **THEN** `document.title` SHALL be set to
  `"Flow Architect · my-repo · pi"` while mounted AND restored to
  `"pi"` on unmount

### Requirement: Popout page handles four empty-state branches

The popout page SHALL render one of four empty-state branches when the
architect cannot be displayed, evaluated in order:

1. Subscription not yet resolved → "Loading parent session…"
2. Parent session metadata not found → "Parent session not found —
   close tab" with close-tab CTA
3. No architect active on the parent session → "No architect active"
4. (Default) → resolved render

#### Scenario: No architect active

- **WHEN** the subscription has resolved AND
  `architectState === undefined`
- **THEN** the page SHALL render an empty state with the text
  "No architect active"

