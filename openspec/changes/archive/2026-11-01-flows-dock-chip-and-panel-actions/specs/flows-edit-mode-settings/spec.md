## MODIFIED Requirements

### Requirement: New/Edit action gated on edit-mode

The authoring actions SHALL be shown only when the session's effective edit mode is on. The authoring actions are **Edit…**, **New flow…** and **Delete…** in the pencil popover (opened from the FLOWS dock chip or a flow panel header's Edit… button) for a session with flows, and **New flow…** in the session actions menu for a session without flows. Effective edit mode is resolved for the session's cwd the same way pi-flows resolves it: the project `<cwd>/.pi/settings.json` value if set, else the global value, else off. Each file may hold `flows.editFlow` or the legacy top-level `flowsEditFlow`. While the value is unknown, the authoring actions SHALL be hidden.

#### Scenario: Hidden when edit-mode off
- **WHEN** a session's effective edit mode is off
- **THEN** no authoring action SHALL be rendered in its pencil popover or its actions menu

#### Scenario: Shown when edit-mode on
- **WHEN** a session with flows has its effective edit mode on
- **THEN** the pencil popover SHALL render Edit…, New flow… and Delete…

#### Scenario: Flowless session shows New flow in the menu
- **WHEN** a session without flows has its effective edit mode on
- **THEN** its actions menu SHALL render **New flow…**

#### Scenario: Project override is reflected
- **GIVEN** the global `flows.editFlow` is `false` and `<cwd>/.pi/settings.json` sets `flows.editFlow: true`
- **WHEN** the pencil popover or actions menu of a session in that cwd renders
- **THEN** the authoring actions SHALL be rendered

#### Scenario: Global save reaches idle sessions
- **GIVEN** a session is idle and its cwd has no project edit-mode value
- **WHEN** the user saves the global Edit mode toggle on
- **THEN** that session's authoring actions SHALL appear without the session starting a turn

#### Scenario: State unavailable
- **WHEN** the effective edit mode cannot be obtained for a session (plugin server unreachable, request failed)
- **THEN** neither the authoring actions nor the per-project edit-mode item SHALL be rendered

### Requirement: Explicit per-project edit-mode action

Once a session's effective edit mode is known, the dashboard SHALL offer one per-project edit-mode item: "Turn on edit mode for this project" when the mode is off, or "Turn off edit mode for this project" when it is on. It SHALL appear in the FLOWS dock chip's pencil popover for a session with flows. For a session without flows it SHALL appear in the session actions menu only as "Turn on edit mode for this project" while the mode is off; once the mode is on, the menu SHALL offer New flow… instead. The hint SHALL say it writes `<cwd>/.pi/settings.json` and that the project value then overrides the global default. Choosing it SHALL request the value its label names. The server SHALL send `flow:set-edit-mode` to that session only, and only when the current effective value differs. Opening the pencil popover or the session actions menu SHALL re-read the effective edit mode.

#### Scenario: Turning on for one project
- **GIVEN** a session's effective edit mode is off
- **WHEN** the user chooses "Turn on edit mode for this project"
- **THEN** exactly one `flow:set-edit-mode { enabled: true }` SHALL be sent to that session
- **AND** no message SHALL be sent to any other session
- **AND** the global pi settings file SHALL be unchanged

#### Scenario: Sibling sessions follow
- **GIVEN** two sessions share a cwd
- **WHEN** the user turns edit mode on for that project from one of them and pi-flows has written the project file
- **THEN** both sessions SHALL show edit mode on wherever the item appears

#### Scenario: Stale label sends nothing
- **GIVEN** the item shows "Turn on edit mode for this project" but the project file was already set to `true` out of band
- **WHEN** the user chooses the item
- **THEN** no `flow:set-edit-mode` SHALL be sent
- **AND** the item SHALL update to show edit mode on

#### Scenario: Session not reachable
- **WHEN** the user chooses the item and the event cannot be delivered to the session
- **THEN** the user SHALL see an error notification
- **AND** the item SHALL keep showing the unchanged state

#### Scenario: Out-of-band change is picked up on menu open
- **GIVEN** the user ran `/flows:edit-mode on` inside the session, or edited the project settings file by hand
- **WHEN** the user opens the pencil popover or the session actions menu
- **THEN** it SHALL show the new effective state

#### Scenario: Item lives in the popover for a session with flows
- **WHEN** a session's flow catalog lists at least one flow and its edit mode is known
- **THEN** the per-project item SHALL be in the pencil popover and SHALL NOT be in the session actions menu

#### Scenario: Label follows the effective state
- **WHEN** a session's effective edit mode is on
- **THEN** the item SHALL read "Turn off edit mode for this project"

#### Scenario: Item hidden while unknown
- **WHEN** the session's effective edit mode is not yet known
- **THEN** the per-project edit-mode item SHALL NOT be rendered
