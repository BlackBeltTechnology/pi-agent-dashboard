## MODIFIED Requirements

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

The "New / Edit…" action SHALL be shown only when the session's effective edit mode is on. Effective edit mode is resolved for the session's cwd the same way pi-flows resolves it: the project `<cwd>/.pi/settings.json` value if set, else the global value, else off. Each file may hold `flows.editFlow` or the legacy top-level `flowsEditFlow`. While the value is unknown, the action SHALL be hidden.

#### Scenario: Hidden when edit-mode off
- **WHEN** a session's effective edit mode is off
- **THEN** the "New / Edit…" action SHALL NOT be rendered in its actions menu

#### Scenario: Shown when edit-mode on
- **WHEN** a session's effective edit mode is on
- **THEN** the "New / Edit…" action SHALL be rendered

#### Scenario: Project override is reflected
- **GIVEN** the global `flows.editFlow` is `false` and `<cwd>/.pi/settings.json` sets `flows.editFlow: true`
- **WHEN** the actions menu of a session in that cwd renders
- **THEN** the "New / Edit…" action SHALL be rendered

#### Scenario: Global save reaches idle sessions
- **GIVEN** a session is idle and its cwd has no project edit-mode value
- **WHEN** the user saves the global Edit mode toggle on
- **THEN** that session's "New / Edit…" action SHALL appear without the session starting a turn

#### Scenario: State unavailable
- **WHEN** the effective edit mode cannot be obtained for a session (plugin server unreachable, request failed)
- **THEN** neither the "New / Edit…" action nor the per-project edit-mode item SHALL be rendered

## REMOVED Requirements

### Requirement: Edit-mode default reconciled to a session on flows availability
**Reason**: Each emit makes pi-flows write `flows.editFlow` (and a project-local skill file) into the repo, which dirties every repo opened in the dashboard. pi-flows already reads the global value, so the reconcile is no longer needed.
**Migration**: The global toggle now writes `<home>/.pi/agent/settings.json#flows.editFlow`, which pi-flows honours directly. Per-repo values are set by the explicit per-project action or `/flows:edit-mode`.

### Requirement: Optional per-session override toggle
**Reason**: Superseded. pi-flows persists every `flow:set-edit-mode` to the project file, so a "session only" override never existed; it was a project write.
**Migration**: Use the explicit "edit mode for this project" action in the session actions menu.

## ADDED Requirements

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

Once a session's effective edit mode is known, its actions menu SHALL offer one item: "Turn on edit mode for this project" when the mode is off, or "Turn off edit mode for this project" when it is on. The hint SHALL say it writes `<cwd>/.pi/settings.json` and that the project value then overrides the global default. Choosing it SHALL request the value its label names. The server SHALL send `flow:set-edit-mode` to that session only, and only when the current effective value differs.

#### Scenario: Turning on for one project
- **GIVEN** a session's effective edit mode is off
- **WHEN** the user chooses "Turn on edit mode for this project"
- **THEN** exactly one `flow:set-edit-mode { enabled: true }` SHALL be sent to that session
- **AND** no message SHALL be sent to any other session
- **AND** the global pi settings file SHALL be unchanged

#### Scenario: Sibling sessions follow
- **GIVEN** two sessions share a cwd
- **WHEN** the user turns edit mode on for that project from one of them and pi-flows has written the project file
- **THEN** both sessions' menus SHALL show edit mode on

#### Scenario: Stale label sends nothing
- **GIVEN** the menu shows "Turn on edit mode for this project" but the project file was already set to `true` out of band
- **WHEN** the user chooses the item
- **THEN** no `flow:set-edit-mode` SHALL be sent
- **AND** the menu SHALL update to show edit mode on

#### Scenario: Session not reachable
- **WHEN** the user chooses the item and the event cannot be delivered to the session
- **THEN** the user SHALL see an error notification
- **AND** the menu SHALL keep showing the unchanged state

#### Scenario: Out-of-band change is picked up on menu open
- **GIVEN** the user ran `/flows:edit-mode on` inside the session, or edited the project settings file by hand
- **WHEN** the user opens the session actions menu
- **THEN** the menu SHALL show the new effective state

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
