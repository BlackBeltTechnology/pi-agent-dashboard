# flow-agent-detail delta

## ADDED Requirements

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
