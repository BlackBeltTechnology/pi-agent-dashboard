# subagent-popout-view Specification

## Purpose
The subagent popout view provides a fullscreen, session-scoped route for inspecting a single subagent of a parent pi session. It registers a `shell-overlay-route` claim at `/session/:sessionId/subagent/:agentId`, resolves the parent session, cold-open subscribes to that session so the subagent's timeline can load in a standalone tab, and renders page chrome plus graceful loading/not-found states.

## Requirements

### Requirement: Overlay route registration
The subagent popout view SHALL register a `shell-overlay-route` slot claim that matches the parent-session-scoped path `/session/:sessionId/subagent/:agentId` and identifies `sessionId` as the session parameter.

#### Scenario: Route pattern matches and dispatches
- **WHEN** the shell location matches `/session/:sessionId/subagent/:agentId`
- **THEN** the overlay-route slot renders the subagent popout claim as fullscreen content
- **AND** the claim receives the extracted `params` (`sessionId`, `agentId`), the parent `session` resolved from the `sessionId` param, and an `onBack` callback

#### Scenario: Non-matching location
- **WHEN** the shell location does not match the claimed path
- **THEN** the overlay-route slot renders no subagent popout content

### Requirement: Cold-open subscription to the parent session
The subagent popout view SHALL subscribe to the parent session exactly once per popout instance, and only after the shell WebSocket connection is open, so the popout works when opened directly (cold open) in a standalone tab.

#### Scenario: Subscribe once connection is open
- **WHEN** the popout is mounted with a non-empty `sessionId` and the shell connection status becomes `connected`
- **THEN** the view sends a `subscribe` action for that `sessionId` starting from sequence 0
- **AND** it sends the subscribe action at most once for the lifetime of that popout instance

#### Scenario: Defer subscription until connected
- **WHEN** the popout is mounted but the shell connection is not yet `connected`
- **THEN** the view does not send the subscribe action until the connection becomes `connected`

### Requirement: Subscription resolution and loading state
The subagent popout view SHALL treat the parent-session subscription as unresolved until either the parent session metadata is known or subagent data for that session has arrived, and SHALL show a loading state while unresolved.

#### Scenario: Loading before resolution
- **WHEN** the parent session metadata is not yet known and no subagents for the session have been received
- **THEN** the page shows a "Loading parent session…" state

#### Scenario: Resolution via session metadata or subagent data
- **WHEN** the parent session metadata becomes known, or at least one subagent for the session arrives
- **THEN** the subscription is treated as resolved and the loading state is dismissed

### Requirement: Page chrome and title
The subagent popout view SHALL present a chrome header for a found subagent and SHALL set the browser tab title from the subagent identity while mounted.

#### Scenario: Header for a found subagent
- **WHEN** the subscription is resolved, the parent session exists, and the subagent identified by `agentId` is present in the parent session's subagents map
- **THEN** the page renders a header showing the parent-session label (falling back to `sessionId`) and the subagent's display name (falling back to its type)
- **AND** the header shows a back affordance that invokes `onBack` when the callback is provided
- **AND** the subagent detail is rendered in popout mode

#### Scenario: Document title lifecycle
- **WHEN** the popout page is mounted
- **THEN** the browser tab title is set to the subagent display name (or type or `agentId`) followed by the parent label (or `sessionId`) and `pi`
- **AND** the title is reset to `pi` when the page unmounts

### Requirement: Not-found and empty states
The subagent popout view SHALL render distinct, actionable states when the parent session is absent from client state or when the target subagent is missing from a resolved parent session.

#### Scenario: Parent session not found
- **WHEN** the subscription is resolved but the parent session is absent from client state
- **THEN** the page shows a "Parent session not found" message explaining the session may have been archived or deleted
- **AND** the page offers a control that closes the browser tab

#### Scenario: Subagent cleared from parent history
- **WHEN** the subscription is resolved and the parent session exists, but the subagent identified by `agentId` is not in the parent session's subagents map
- **THEN** the page shows a header with the back affordance and a message that the subagent may have been cleared from the parent session's history
