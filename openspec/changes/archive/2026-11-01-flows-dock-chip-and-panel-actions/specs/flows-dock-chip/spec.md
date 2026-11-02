## ADDED Requirements

### Requirement: FLOWS chip shows only when the session has flows

The flows plugin SHALL contribute a group labelled `FLOWS` to the composer dock's Context lane (slot `composer-context-group`). It SHALL render only when the session's flow catalog contains at least one flow. With an empty or unknown catalog it SHALL render nothing and leave no label or container behind.

#### Scenario: Session with flows
- **WHEN** the bound session's catalog lists `batch:apply`
- **THEN** the dock's Context lane SHALL show a `FLOWS` group

#### Scenario: Session without flows
- **WHEN** the bound session's catalog is empty
- **THEN** no `FLOWS` label or group container SHALL render in the dock

#### Scenario: Catalog not yet known
- **WHEN** no catalog event has been seen for the bound session
- **THEN** no `FLOWS` group SHALL render

### Requirement: The chip names the open or last flow and its status

When the session has a running, completed or opened (not started) flow, the chip SHALL show that flow's name and a status pill: running with steps done out of total, failed, done, aborted, or not started. When no flow is open and none has run, the chip SHALL show only its actions. The status pill SHALL carry its state in text, not colour alone.

#### Scenario: Failed flow
- **WHEN** the last flow `batch:apply` failed after 19 steps
- **THEN** the chip SHALL show `batch:apply` with a pill reading failed and the step count

#### Scenario: Running flow
- **WHEN** `batch:apply` is running with 7 of 19 steps done
- **THEN** the chip SHALL show `batch:apply` with a pill reading running 7/19

#### Scenario: Nothing open yet
- **WHEN** the catalog has flows but no flow is open and none has run
- **THEN** the chip SHALL show its actions without a flow name or pill

### Requirement: Chip actions

The chip SHALL offer three icon buttons, each with an accessible name and tooltip: **Run flow…**, **Open flow…** and **Edit…**. Run flow… SHALL open the flow picker and then the task dialog (task optional unless the flow requires one), then start the chosen flow. Open flow… SHALL open the flow picker and put the chosen flow in the flow panel without starting it. While any flow in the session is running, Run flow… and Open flow… SHALL be disabled with the reason "A flow is running". Each button SHALL meet the dock's minimum target size. Chip controls SHALL stay enabled while the agent is working, except as stated for a running flow.

#### Scenario: Run from the chip
- **WHEN** the user activates Run flow…, picks `batch:apply` and confirms the task dialog
- **THEN** `batch:apply` SHALL start in that session

#### Scenario: Open from the chip
- **WHEN** the user activates Open flow… and picks `ship-it`
- **THEN** the flow panel SHALL show `ship-it` as not started

#### Scenario: Disabled while a flow runs
- **WHEN** a flow in the session is running
- **THEN** Run flow… and Open flow… SHALL be disabled and SHALL say "A flow is running"
- **AND** Edit… SHALL stay enabled

#### Scenario: Usable while the agent works
- **WHEN** the agent is streaming a turn and no flow is running
- **THEN** all three chip buttons SHALL be enabled

### Requirement: The pencil opens the authoring popover

Edit… SHALL open a popover anchored to the chip. When the session's effective edit mode is on, it SHALL list **Edit…** (pick a flow, then author it), **New flow…** and **Delete…** (pick a flow, confirm, delete). It SHALL always list the per-project edit-mode item once edit mode is known (see `flows-edit-mode-settings`). Opening the popover SHALL re-read the session's effective edit mode. While edit mode is off, the popover SHALL show only the edit-mode item. While the session's edit mode is still unknown, the popover SHALL show a loading line and no authoring items. Delete… SHALL appear only when the session's commands include `flows:delete`. Opening the Run or Open picker SHALL ask the session for a fresh catalog (pi-flows rediscovers from disk first), so a flow removed outside pi-flows disappears from the picker once the fresh catalog arrives.

#### Scenario: Edit mode on
- **WHEN** edit mode is on and the user opens the pencil popover
- **THEN** it SHALL list Edit…, New flow…, Delete… and "Turn off edit mode for this project"

#### Scenario: Edit mode off
- **WHEN** edit mode is off and the user opens the pencil popover
- **THEN** it SHALL list only "Turn on edit mode for this project"

#### Scenario: Out-of-band change seen on open
- **GIVEN** the project's edit mode was turned on outside the dashboard
- **WHEN** the user opens the pencil popover
- **THEN** the popover SHALL show the authoring items

#### Scenario: Keyboard
- **WHEN** the user opens the popover with the keyboard
- **THEN** focus SHALL move into the popover, arrow keys SHALL move between items, and Escape SHALL close it and return focus to the pencil button

#### Scenario: Picker refreshes the catalog
- **GIVEN** a flow directory was deleted by hand while the session ran
- **WHEN** the user opens the Run or Open picker
- **THEN** the session SHALL rediscover and publish a fresh catalog and the deleted flow SHALL leave the picker
