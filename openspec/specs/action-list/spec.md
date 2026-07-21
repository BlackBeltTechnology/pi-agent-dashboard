# action-list Specification

## Purpose

The action-list primitive renders a server-driven, horizontal row of action buttons. Each button carries a label, optional icon and tooltip, and dispatches a plugin action intent back to the server when clicked, letting plugins expose interactive controls to every connected client.

## Requirements

### Requirement: Server-driven button rendering

The action-list SHALL render each descriptor in the received `actions` array as a horizontal button showing its label, and SHALL render nothing when the array is absent or empty.

#### Scenario: Render actions as buttons

- **WHEN** the primitive receives `actions` containing one or more items
- **THEN** it renders one button per item, laid out horizontally with wrapping
- **AND** each button displays the item's `label`

#### Scenario: Empty or missing action list

- **WHEN** `actions` is undefined or an empty array
- **THEN** the primitive renders nothing

#### Scenario: Optional icon and tooltip

- **WHEN** an action item has an `icon` key and/or a `tooltip`
- **THEN** the button renders the MDI icon resolved from that key, showing nothing for an unknown key
- **AND** exposes the `tooltip` as the button's hover title

### Requirement: Action dispatch on click

The action-list SHALL dispatch an action item's server-side descriptor as a `plugin_action` message when the button is clicked, and SHALL also invoke a direct `onClick` handler if the item provides one.

#### Scenario: Dispatch a server-side action descriptor

- **WHEN** the user clicks a button whose item carries a `dataAction` descriptor
- **THEN** a `plugin_action` message is sent to the server with `pluginId`, `sessionId` (defaulting to `null` when absent), `action`, and the optional `payload` from the descriptor

#### Scenario: Direct callback item

- **WHEN** the user clicks a button whose item provides an `onClick` handler
- **THEN** that handler is invoked

#### Scenario: Dispatch when disconnected

- **WHEN** an action is dispatched while no WebSocket sender is registered
- **THEN** the dispatch is a no-op and no message is sent

### Requirement: Disabled action handling

The action-list SHALL prevent interaction with a disabled action, both visually and behaviorally.

#### Scenario: Click on a disabled action

- **WHEN** the user clicks a button whose item has `disabled` set to true
- **THEN** the button is non-interactive and neither a `plugin_action` message nor the `onClick` handler is triggered
