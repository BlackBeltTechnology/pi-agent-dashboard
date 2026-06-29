# flow-agent-detail Specification

## Purpose

Defines the FlowAgentDetail view: clicking a flow agent card replaces the chat view with that agent's full history (tool calls, assistant text, thinking, metadata), with the tool-call rows rendered without the leading per-entry status glyph.

## Requirements

### Requirement: Agent detail replaces chat view
Clicking an agent card SHALL replace the chat view content area with a `FlowAgentDetail` component showing the full history for that agent. The flow card grid SHALL remain visible (sticky top). A back button SHALL return to the chat view.

#### Scenario: Navigate to agent detail
- **WHEN** the user clicks an agent card in the flow dashboard
- **THEN** the content area SHALL render `FlowAgentDetail` for that agent instead of `ChatView`

#### Scenario: Back button returns to chat
- **WHEN** the user clicks the back button in the agent detail view
- **THEN** the content area SHALL return to rendering `ChatView`

### Requirement: Agent detail shows tool call history
The agent detail view SHALL display all tool calls for the agent in chronological order. Each tool call entry SHALL show: tool name, input preview (path for read/write/edit, command for bash, pattern for grep), output (collapsible), error status, and duration if available. Tool call entries in the agent detail view SHALL NOT render the leading per-entry status glyph (the status/`ask_user` icon shown in the main chat tool renderer); the opt-out SHALL be scoped to the flow agent views and SHALL NOT affect the main chat tool renderer.

#### Scenario: Tool call with file path
- **WHEN** a tool call for `read` with `{ path: "src/foo.ts" }` is displayed
- **THEN** the entry SHALL show "read · src/foo.ts"

#### Scenario: Tool call with error
- **WHEN** a tool call has `isError: true`
- **THEN** the entry SHALL be visually marked as an error (red accent)

#### Scenario: No leading status icon in agent detail
- **WHEN** a tool call entry renders in the flow agent detail view
- **THEN** no leading status/`ask_user` glyph SHALL appear before the tool name
- **AND** the same tool renderer in the main chat SHALL still show its status glyph

### Requirement: Agent detail shows assistant text and thinking
The agent detail view SHALL display assistant text blocks and thinking traces interleaved with tool calls in chronological order.

#### Scenario: Assistant text displayed
- **WHEN** `flow_assistant_text` events exist for the agent
- **THEN** assistant text blocks SHALL be rendered as markdown content

#### Scenario: Thinking traces displayed
- **WHEN** `flow_thinking_text` events exist for the agent
- **THEN** thinking blocks SHALL be rendered in a collapsible section with a "Thinking" label

### Requirement: Agent detail header shows agent metadata
The agent detail header SHALL show the agent name, status, model role, token usage, and duration.

#### Scenario: Running agent header
- **WHEN** viewing detail for a running agent
- **THEN** the header SHALL show the agent name, a running indicator, and model role

#### Scenario: Complete agent header
- **WHEN** viewing detail for a completed agent
- **THEN** the header SHALL show agent name, ✓ status, tokens (↑in ↓out), and duration

### Requirement: Agent detail opens in a dialog from the card

The `FlowAgentCard` eye/Details affordance SHALL open the agent detail in the
shell `ui:dialog` primitive (vertical `lg` size) instead of an anchored popover.
The dialog body SHALL wrap `FlowAgentDetail` directly with the in-hand `agent`
object (no route lookup, no fabricated session shape). Because `FlowAgentDetail`
(`MinimalChatView` popout mode) renders its OWN header (back arrow, status,
title, model, tokens, duration), the dialog SHALL be opened `flush` and WITHOUT
a `title` to avoid a double header / window-in-window; `FlowAgentDetail`'s
header becomes the single window header and its `onBack` maps to `onClose`.

#### Scenario: Details opens a dialog

- **WHEN** the user clicks the Details (eye) button on a flow agent card
- **THEN** a `Dialog` SHALL open containing the agent's detail timeline
  rendered by `FlowAgentDetail`

#### Scenario: Dialog dismisses

- **WHEN** the agent detail dialog is open and the user presses Esc, clicks
  the overlay, or triggers the page's back/close control
- **THEN** the dialog SHALL close and the card returns to its non-expanded
  state

#### Scenario: No anchored popover for detail

- **WHEN** a flow agent card renders its controls
- **THEN** the detail affordance SHALL NOT open an anchored `Popover` for the
  agent timeline (the dialog replaces it)
