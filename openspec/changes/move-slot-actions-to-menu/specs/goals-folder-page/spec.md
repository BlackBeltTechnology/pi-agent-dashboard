## MODIFIED Requirements

### Requirement: Goals folder nav slot

A folder nav slot SHALL show `Goals (N) →` (opens the goals board). It SHALL render no
`+ Goal` affordance of its own: goal creation is an item in the folder actions menu's
`CREATE` group. Activating that item SHALL open the shared goal create dialog (see *Goal
create presented as a modal dialog*); the objective + acceptance criteria + judge/budget
captured there SHALL create a `GoalRecord` for the folder.

#### Scenario: Nav slot shows count and opens board

- **WHEN** the slot renders for folder cwd `C` with `N` goals
- **THEN** it SHALL show `Goals (N)`
- **AND** `→` SHALL navigate to the goals board for `C`
- **AND** the slot SHALL render no create affordance

#### Scenario: Create affordance lives in the menu

- **WHEN** the user activates the goal-create item in the folder actions menu for folder `C`
- **THEN** the shared goal create dialog SHALL open
- **AND** submitting it SHALL create a `GoalRecord` for `C`
