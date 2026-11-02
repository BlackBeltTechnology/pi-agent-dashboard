## REMOVED Requirements

### Requirement: Flow launcher in session card

**Reason**: The session card no longer hosts a flow launcher, and the core `flows_list` message it read is removed. Flows are run from the FLOWS dock chip and the flow panel header (see `flows-dock-chip`, `flow-summary-view`).
**Migration**: Use the dock chip's Run flow… action.

### Requirement: Flow launcher also available in content area header

**Reason**: The "▶ Flow" header button no longer exists and read the removed core `flows` array. Its role is taken by the FLOWS dock chip and the flow panel header (see `flows-dock-chip`, `flow-summary-view`, `flow-controls`).
**Migration**: Use the dock chip's Run flow… or Open flow… actions.

## MODIFIED Requirements

### Requirement: Dashboard does not register flow slash commands

The dashboard plugin manifest for `@blackbelt-technology/pi-dashboard-flows-plugin` SHALL NOT claim the `command-route` slot for any of `/flows`, `/flows:new`, `/flows:edit`, `/flows:delete`. All flow operations in the dashboard SHALL be driven by button UI: the FLOWS dock chip and its pencil popover, the flow panel header actions (including Abort), and, for a session without flows, the New flow… item in the session actions menu.

This SHALL NOT affect `pi-flows`'s own registration of these commands at the pi-extension level — slash commands MUST remain available in the TUI and any standalone pi-flows host. The dashboard simply chooses not to surface them.

Rationale: dashboard interaction is button-first; slash commands duplicate functionality that is already exposed as buttons and create discoverability noise in autocomplete.

#### Scenario: Manifest contains no flow command-route claims

- **WHEN** the dashboard plugin loader discovers `@blackbelt-technology/pi-dashboard-flows-plugin`
- **THEN** the loaded manifest's `claims[]` SHALL NOT contain any entry with `slot: "command-route"` and `command` starting with `/flows`

#### Scenario: TUI still has slash commands

- **WHEN** a user runs pi-flows standalone in TUI mode
- **THEN** typing `/flows:new` SHALL invoke the pi-flows-registered command exactly as before (pi-flows code path unchanged)

#### Scenario: Dashboard new-flow flows through button

- **WHEN** the user wants to start a new flow in the dashboard
- **THEN** the user SHALL choose New flow… from the FLOWS dock chip's pencil popover (session with flows) or from the session actions menu (session without flows), which starts the authoring flow over the existing channel

#### Scenario: Dashboard abort flows through button

- **WHEN** a flow is running in the dashboard and the user wants to abort
- **THEN** the user SHALL click the Abort button rendered by `FlowDashboard`, which dispatches `flow_control { action: "abort" }` over the existing WebSocket
