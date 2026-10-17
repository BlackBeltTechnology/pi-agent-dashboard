## MODIFIED Requirements

### Requirement: Shell SHALL render all flow content via plugin slot claims

The shell SHALL NOT directly import or render any `Flow*` component.
All flow rendering SHALL go through slot consumers populated by
`flows-plugin` claims. Specifically:

- The flow status part of `SessionFlowActions` (the running / completed flow badge and its abort control) rendered via the `session-card-flows` slot, inside the FLOWS subcard.
- The flow actions (Run Flow…, Open flow…, New / Edit…, Delete) rendered via the `session-card-action-bar` slot. On the desktop session card their output appears in the session actions menu's PLUGINS group.
- `FlowDashboard` and `FlowArchitect` rendered via
  `content-header-sticky` slot.
- `FlowAgentDetail`, `FlowArchitectDetail`, `FlowYamlPreview`
  rendered via `content-view` slot, each with a distinct `route`.
- `FlowSummary` rendered via `content-inline-footer` slot.
- Slash-command wrappers (`/flows`, `/flows:new`, `/flows:edit`,
  `/flows:delete`) rendered via `command-route` slot.

The shell SHALL NOT pass flow-specific props to any slot consumer.
Slot consumers receive the standard prop contract for their slot
(`{ session, pluginContext }` or
`{ session, routeParams, onClose, pluginContext }` for content-view).

#### Scenario: Single content-header-sticky claim renders FlowArchitect

- **GIVEN** a session whose event stream has produced a non-null
  `architectState` inside `flows-plugin`'s internal context
- **WHEN** the shell renders `<ContentHeaderStickySlot session={...}>`
- **THEN** `<FlowArchitect>` SHALL render exactly once via the slot
  contribution
- **AND** the rendering SHALL not require any flow-specific props from
  the shell

#### Scenario: FlowArchitect collapses across selection states

- **GIVEN** the user is viewing a session with both `architectState`
  and `flowState` set
- **WHEN** the user transitions through architect-detail, flow-detail,
  and default content views
- **THEN** `<FlowArchitect>` SHALL be rendered exactly once at any
  point in time
- **AND** dismissal callbacks SHALL be uniform across all selection
  states (handled by the plugin's internal UI-state context)

#### Scenario: FlowDashboard collapses across selection states

- **GIVEN** the user is viewing a session with `flowState` set
- **WHEN** the user transitions through flow-detail and default views
- **THEN** `<FlowDashboard>` SHALL be rendered exactly once at any
  point in time

#### Scenario: SessionFlowActions renders inside FLOWS subcard

- **GIVEN** a session with a running flow, whose `commandsList` includes a flows-namespaced command
- **WHEN** the desktop session card is rendered
- **THEN** the flow status SHALL render exactly once inside the FLOWS subcard via the `session-card-flows` slot
- **AND** the flow actions SHALL NOT render inside the FLOWS subcard
- **AND** they SHALL render via the `session-card-action-bar` slot in the session actions menu's PLUGINS group
