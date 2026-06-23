# goals-folder-page Specification

## Purpose
Folder-scoped goals. Dashboard owns durable `GoalRecord` (objective, criteria, status, linked sessions) per cwd; the @ricoyudog/pi-goal-hermes extension owns live loop state, associated by `goalId`. Surfaces a `Goals (N) →` folder nav slot, a goals board, and a goal detail page that links 1:N sessions and opens their chat views (including hidden driver/worker sessions).
## Requirements
### Requirement: Folder-scoped goal record store

The system SHALL persist goals as cwd-keyed `GoalRecord` entries durable across restarts, mirroring the OpenSpec group store (atomic write, per-folder).

#### Scenario: Create and persist a goal
- **WHEN** a goal is created for folder cwd `C` with an objective
- **THEN** a `GoalRecord { id, cwd: C, objective, status: "pursuing", sessionIds: [], createdAt, updatedAt }` is persisted
- **AND** it survives a dashboard server restart

#### Scenario: Goals are scoped to their folder
- **WHEN** goals are listed for folder cwd `C`
- **THEN** only `GoalRecord`s with `cwd === C` are returned

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

### Requirement: Goal-to-session linking (1:N)

A goal SHALL own zero or more sessions, trackable and mutable from the goal card.

#### Scenario: Spawn a session under a goal
- **WHEN** the user activates `+ New session` on goal `G`
- **THEN** the spawned session is stamped with `goalId === G.id`
- **AND** `G.sessionIds` includes the new session id

#### Scenario: Link an existing running session
- **WHEN** the user links running session `S` to goal `G`
- **THEN** `G.sessionIds` includes `S` and `S` meta carries `goalId === G.id`

#### Scenario: Unlink a session
- **WHEN** the user unlinks session `S` from goal `G`
- **THEN** `G.sessionIds` no longer includes `S` and `S` meta `goalId` is cleared

#### Scenario: Deleting a goal clears links
- **WHEN** goal `G` is deleted
- **THEN** every session formerly in `G.sessionIds` has its `goalId` cleared

### Requirement: Embedded chatview for goal sessions including hidden ones

The goal detail page SHALL open the chat view of any linked session, including auto-hidden driver/worker sessions, without changing their `hidden` status in the sidebar.

#### Scenario: Open the driver session chatview
- **WHEN** the user opens a linked session from goal detail for `G` whose `driverSessionId` is an auto-hidden session
- **THEN** that session's chat view opens (v1: in-app navigation to `/session/:id`; a richer embedded variant is a tracked follow-up)
- **AND** the session remains `hidden` in the sidebar (not auto-navigated, not unhidden)

#### Scenario: Switch between linked sessions
- **WHEN** goal `G` has multiple linked sessions
- **THEN** the goal detail page lists every session in `G.sessionIds` and can open each one's chat view

### Requirement: Per-session goal control demotes to a link chip

With goal creation/management at the folder level, the session-card goal surface SHALL become a read-only link to the owning goal rather than a create/control surface.

#### Scenario: Session card chip links to its goal
- **WHEN** session `S` has `goalId === G.id`
- **THEN** its session-card goal chip is read-only and navigates to goal `G` detail when activated
- **AND** the "Set a goal…" input no longer appears on the session card

#### Scenario: Live status rolls up by goalId
- **WHEN** a `goal_status` snapshot for session `S` (carrying `goalId === G.id`) updates
- **THEN** goal `G`'s card reflects the latest live turns/verdict/paused state for that session

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

