# flows-edit-mode-settings Specification

## Purpose
Flows-plugin binds its global edit-mode default to `flows.editFlow` in `~/.pi/agent/settings.json` (the file pi-flows reads; default off), never writes a project `.pi/settings.json` implicitly, offers an explicit per-project edit-mode action as the only sender of flow:set-edit-mode, gates the New/Edit action on the session's effective edit mode (project overriding global), and migrates a legacy plugin-config value once.

## Requirements

### Requirement: Global edit-mode default in plugin config

The flows-plugin settings section SHALL bind its "Edit mode" toggle to `flows.editFlow` in the global settings file pi-flows reads: `<home>/.pi/agent/settings.json`, where `<home>` is the OS home directory, whatever `PI_CODING_AGENT_DIR` says. Saving SHALL write only that key, under pi's settings lock, preserving every other key. No project `.pi/settings.json` SHALL be written. Unset reads as off.

#### Scenario: Settings section renders the toggle
- **WHEN** the user opens Settings › Plugins › Flows
- **THEN** an "Edit mode" toggle SHALL be shown bound to `flows.editFlow` in the global pi settings file
- **AND** committing the draft SHALL write that key and nothing else

#### Scenario: Default is off
- **WHEN** the global pi settings file has neither `flows.editFlow` nor the legacy top-level `flowsEditFlow`
- **THEN** the toggle SHALL show off

#### Scenario: Legacy top-level key is shown
- **GIVEN** the global pi settings file has `flowsEditFlow: true` and no `flows.editFlow`
- **WHEN** the settings section loads
- **THEN** the toggle SHALL show on

#### Scenario: Unrelated global keys survive
- **GIVEN** the global pi settings file holds `packages`, `dashboardPluginBridges` and `flows.someOtherKey`
- **WHEN** the user saves Edit mode on
- **THEN** `flows.editFlow` SHALL be `true`
- **AND** every other key SHALL be deep-equal to its prior value

#### Scenario: Unparseable global settings are not overwritten
- **GIVEN** the global pi settings file contains invalid JSON
- **WHEN** the user saves Edit mode
- **THEN** the save SHALL fail with a parse error shown in the settings section
- **AND** the file SHALL be byte-identical to before

#### Scenario: PI_CODING_AGENT_DIR does not redirect the write
- **GIVEN** `PI_CODING_AGENT_DIR` points at a directory other than `<home>/.pi/agent`
- **WHEN** the user saves Edit mode on
- **THEN** `<home>/.pi/agent/settings.json` SHALL hold `flows.editFlow: true`
- **AND** `$PI_CODING_AGENT_DIR/settings.json` SHALL be unchanged

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

### Requirement: Project settings are never written implicitly

The dashboard SHALL NOT send `flow:set-edit-mode` to a session except as the direct result of the user choosing the per-project edit-mode action for that session. Session connect, flows availability, a page load, a reconnect, a settings save and the legacy migration SHALL NOT send it.

#### Scenario: Opening a repo writes nothing
- **WHEN** a session connects in a repo and flows becomes available, with any global edit-mode value
- **THEN** no `flow:set-edit-mode` SHALL be sent to that session

#### Scenario: Saving the global toggle sends nothing to sessions
- **WHEN** the user saves the global Edit mode toggle while sessions are connected
- **THEN** no `flow:set-edit-mode` SHALL be sent to any session

#### Scenario: Several browser tabs send nothing
- **WHEN** two dashboard tabs show the same session card
- **THEN** neither tab SHALL send `flow:set-edit-mode`

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

### Requirement: Edit-mode routes are guarded and narrow

The plugin's edit-mode HTTP routes SHALL sit behind the host network guard and a rate limit. The global-default write SHALL accept only a body `{ enabled: boolean }` and SHALL write only `flows.editFlow`, with no caller-supplied path. The per-session read SHALL resolve the cwd only from the host's session registry, never from a caller-supplied path, and SHALL perform no writes.

#### Scenario: Non-boolean body rejected
- **WHEN** the global-default write receives `{ enabled: "yes" }`
- **THEN** it SHALL respond 400
- **AND** the global settings file SHALL be unchanged

#### Scenario: Settings lock held
- **WHEN** the global-default write cannot acquire pi's settings lock within its retry budget
- **THEN** it SHALL respond 503
- **AND** the global settings file SHALL be unchanged

#### Scenario: Unknown session
- **WHEN** the per-session read is called with a session id that is not active
- **THEN** it SHALL respond 404 before reading any file

#### Scenario: Unparseable project settings
- **GIVEN** `<cwd>/.pi/settings.json` contains invalid JSON
- **WHEN** the per-session read runs for a session in that cwd
- **THEN** the project value SHALL be treated as unset, as pi-flows does
- **AND** the file SHALL be unchanged

### Requirement: Legacy plugin-config value migrates once

On plugin server start, a legacy plugin-config `editFlow: true` SHALL be written once to the global file as `flows.editFlow: true`, but only when the global file has no edit-mode value (checked under the settings lock). The legacy key SHALL then be removed. A legacy `false` SHALL only remove the key. A failed write SHALL keep the key so the next start retries.

#### Scenario: Legacy on is preserved globally
- **GIVEN** plugin config `{ editFlow: true }` and no global edit-mode value
- **WHEN** the plugin server starts
- **THEN** the global file SHALL hold `flows.editFlow: true`
- **AND** plugin config SHALL no longer contain `editFlow`
- **AND** no project `.pi/settings.json` SHALL be written

#### Scenario: Legacy off only clears the key
- **GIVEN** plugin config `{ editFlow: false }`
- **WHEN** the plugin server starts
- **THEN** the global file SHALL be unchanged
- **AND** plugin config SHALL no longer contain `editFlow`

#### Scenario: Existing global value wins
- **GIVEN** plugin config `{ editFlow: true }` and the global file has `flows.editFlow: false`
- **WHEN** the plugin server starts
- **THEN** the global file SHALL be unchanged
- **AND** plugin config SHALL no longer contain `editFlow`

#### Scenario: Unparseable global file defers the migration
- **GIVEN** plugin config `{ editFlow: true }` and an unparseable global file
- **WHEN** the plugin server starts
- **THEN** the global file SHALL be byte-identical to before
- **AND** plugin config SHALL still contain `editFlow: true`
