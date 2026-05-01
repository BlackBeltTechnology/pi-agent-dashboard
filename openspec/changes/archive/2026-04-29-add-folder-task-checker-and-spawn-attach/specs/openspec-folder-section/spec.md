## ADDED Requirements

### Requirement: Change row task counter is clickable to open TasksPopover
For each change row in the expanded folder OpenSpec change list, when `totalTasks > 0` the `{completedTasks}/{totalTasks} tasks` indicator SHALL be rendered as a `<button>` that, when clicked, opens a `TasksPopover` with `cwd` set to the folder's cwd and `change` set to that row's change name. The popover is the existing component used by session cards — no parallel toggle logic is introduced.

#### Scenario: Counter renders as button when tasks exist
- **WHEN** a change row for `"add-auth"` has `completedTasks = 3` and `totalTasks = 8`
- **THEN** the row SHALL render a `<button>` with text `3/8 tasks` and `data-testid="folder-tasks-counter-add-auth"`

#### Scenario: Counter is not interactive when no tasks
- **WHEN** a change row has `totalTasks = 0`
- **THEN** the row SHALL NOT render a tasks-counter button
- **THEN** the existing `ml-auto` spacer behaviour SHALL be preserved so artifact letters stay right-aligned

#### Scenario: Click opens the TasksPopover
- **WHEN** the user clicks the tasks-counter button on the row for change `"add-auth"` in folder `/project/foo`
- **THEN** a `TasksPopover` SHALL be mounted with `cwd = "/project/foo"` and `change = "add-auth"`
- **THEN** the popover SHALL fetch tasks via the existing `GET /api/openspec/tasks?cwd=...&change=...` route (no new endpoint)

#### Scenario: Click does not toggle folder-section collapse
- **WHEN** the user clicks the tasks-counter button on a change row
- **THEN** the click event SHALL stop propagation
- **THEN** the surrounding `FolderOpenSpecSection` collapse state SHALL be unchanged

#### Scenario: Closing the popover unmounts it
- **WHEN** the user closes the popover (Esc, backdrop click, or close button)
- **THEN** the `TasksPopover` SHALL be unmounted
- **THEN** the same row SHALL be re-clickable to re-open the popover

#### Scenario: Only one popover at a time
- **WHEN** a popover is already open for change `"add-auth"` and the user clicks the tasks counter for change `"fix-bug"`
- **THEN** the popover for `"add-auth"` SHALL close
- **THEN** a new popover SHALL open for `"fix-bug"` with `cwd` and `change` reflecting the new selection

### Requirement: Change row exposes spawn-with-attach action
For each change row in the expanded folder OpenSpec change list, when an `onSpawnAttached` callback prop is provided, a "Spawn session attached" icon button SHALL be rendered to the right of the artifact letters button. Clicking it SHALL invoke `onSpawnAttached(cwd, changeName)`.

#### Scenario: Button rendered when callback present
- **WHEN** `FolderOpenSpecSection` is mounted with an `onSpawnAttached` prop and the folder has at least one change
- **THEN** each change row SHALL render a button with `data-testid="spawn-attached-btn-<changeName>"` and a tooltip such as "Spawn session attached to this change"

#### Scenario: Button not rendered when callback absent
- **WHEN** `FolderOpenSpecSection` is mounted without an `onSpawnAttached` prop
- **THEN** no spawn-attached button SHALL be rendered on any change row

#### Scenario: Click invokes callback with cwd and changeName
- **WHEN** the user clicks the spawn-attached button on the row for change `"add-auth"` in folder `/project/foo`
- **THEN** `onSpawnAttached` SHALL be called exactly once with `("/project/foo", "add-auth")`

#### Scenario: Click does not toggle folder-section collapse
- **WHEN** the user clicks the spawn-attached button on a change row
- **THEN** the click event SHALL stop propagation
- **THEN** the surrounding `FolderOpenSpecSection` collapse state SHALL be unchanged

#### Scenario: Bare folder +Session button is unchanged
- **WHEN** the user clicks the existing folder-level `+Session` button on the action bar
- **THEN** the spawn flow SHALL be exactly the bare-spawn behaviour that exists today (no implicit attach)
- **THEN** `onSpawnAttached` SHALL NOT be involved
