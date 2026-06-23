# goals-folder-page — delta

## ADDED Requirements

### Requirement: Goal create presented as a modal dialog

The goal create affordance SHALL open a single shared modal dialog containing the
`GoalForm`, rather than rendering the form inline. The dialog SHALL be opened from both
the folder nav `+ Goal` affordance (`FolderGoalsSection`) and the board `+ New Goal`
affordance (`GoalsBoardClaim`) — one shared component. The dialog overlay SHALL mirror the
plugin create-dialog pattern (`fixed inset-0 z-50 … bg-black/40`, centered `max-w-lg`
card) established by the automation plugin's `CreateAutomationDialog`. The `GoalForm`
fields and the `createGoal` payload SHALL be unchanged from
`sophisticate-goal-authoring-and-control`.

#### Scenario: + Goal opens the dialog

- **WHEN** the user activates `+ Goal` in the folder nav slot
- **THEN** a modal `CreateGoalDialog` SHALL open centered over the dashboard
- **AND** the sidebar SHALL NOT displace its contents to make room for the form

#### Scenario: + New Goal opens the same dialog

- **WHEN** the user activates `+ New Goal` on the goals board
- **THEN** the same modal `CreateGoalDialog` SHALL open
- **AND** the board's filter bar and goal cards SHALL NOT be displaced by the form

#### Scenario: Create from the dialog

- **WHEN** the user submits the `GoalForm` inside the dialog
- **THEN** a `GoalRecord` is created via `createGoal` for the folder cwd
- **AND** the dialog SHALL close and the goals list SHALL refresh

#### Scenario: Dismiss the dialog

- **WHEN** the user clicks the backdrop or the dialog's close control
- **THEN** the dialog SHALL close without creating a goal

## MODIFIED Requirements

### Requirement: Goals folder nav slot

A folder nav slot SHALL show `Goals (N) →` (opens the goals board) plus a `+ Goal`
affordance. Activating `+ Goal` SHALL open the shared goal create dialog (see *Goal create
presented as a modal dialog*); the objective + acceptance criteria + judge/budget captured
there SHALL create a `GoalRecord` for the folder.

#### Scenario: Nav slot shows count and opens board

- **WHEN** the slot renders for folder cwd `C` with `N` goals
- **THEN** it SHALL show `Goals (N)`
- **AND** `→` SHALL navigate to the goals board for `C`

#### Scenario: Create affordance

- **WHEN** the user activates `+ Goal`
- **THEN** the shared goal create dialog SHALL open
- **AND** submitting it SHALL create a `GoalRecord` for `C`

### Requirement: Goals content page

The goals content page (`/folder/:encodedCwd/goals`) SHALL render a header (`← back` /
`Refresh` / `+ New Goal`), a status filter bar, and goal cards. `+ New Goal` SHALL open the
shared goal create dialog (see *Goal create presented as a modal dialog*); the form SHALL
NOT render inline under the header.

#### Scenario: Page lists goal cards with status

- **WHEN** the page loads for folder `C`
- **THEN** it SHALL list one card per goal for `C` with status pill, turn/criteria progress, and spend

#### Scenario: Filter by status

- **WHEN** the user selects a status filter
- **THEN** only goals matching that status SHALL be shown
