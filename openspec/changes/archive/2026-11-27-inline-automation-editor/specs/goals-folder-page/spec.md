## MODIFIED Requirements

### Requirement: Goal create presented as a modal dialog

The goal create affordance SHALL open a single shared modal dialog containing the
`GoalForm`, rather than rendering the form inline. The dialog SHALL be opened from both
the folder actions menu's `CREATE`-group goal-create item (registered by
`FolderGoalsSection`) and the board `+ New Goal` affordance (`GoalsBoardClaim`) — one
shared component. The dialog overlay SHALL use a centered modal pattern
(`fixed inset-0 z-50 … bg-black/40`, centered `max-w-lg` card). The `GoalForm`
fields and the `createGoal` payload SHALL be unchanged from
`sophisticate-goal-authoring-and-control`.

#### Scenario: + Goal opens the dialog

- **WHEN** the user activates the goal-create item in the folder actions menu
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
