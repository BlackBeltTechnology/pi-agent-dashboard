## ADDED Requirements

### Requirement: Folder group header shows OpenSpec section
Each folder group in the session list SHALL render a `FolderOpenSpecSection` component in the folder header, below git info and above editor/spawn buttons, when OpenSpec data for that directory is either `initialized: true` or `pending: true`.

#### Scenario: Directory with initialized OpenSpec
- **WHEN** a folder group is rendered for cwd `/project/foo` and OpenSpec data for that cwd has `initialized: true`
- **THEN** a `FolderOpenSpecSection` SHALL be rendered in the folder header showing the standard collapsed header

#### Scenario: Directory with openspec dir but slow poll pending
- **WHEN** a folder group is rendered for cwd `/project/foo` and OpenSpec data has `initialized: false` and `pending: true`
- **THEN** a `FolderOpenSpecSection` SHALL be rendered in the folder header showing the grey loading spinner (no buttons, no chevron)

#### Scenario: Directory without OpenSpec
- **WHEN** a folder group is rendered for cwd `/project/foo` and OpenSpec data has `initialized: false` and `pending: false` (or is not available)
- **THEN** no OpenSpec section SHALL be rendered in the folder header

#### Scenario: Pinned directory with no sessions
- **WHEN** a pinned directory has OpenSpec data but no active sessions
- **THEN** the `FolderOpenSpecSection` SHALL still be rendered showing change list and folder-level actions

### Requirement: Folder section renders pending spinner when slow poll in flight

When the OpenSpec data for a folder has `pending: true` and is not yet
initialized, the folder header SHALL render a small grey spinner in
place of the usual `OPENSPEC (N CHANGES)` label, indicating to the
user that OpenSpec is detected for this folder and content is loading.
No expand chevron, Refresh, Archive, or Specs buttons SHALL render
while pending. The spinner SHALL inherit the same muted text colour
as the OpenSpec label so it does not draw attention away from active
session cards.

#### Scenario: Folder with openspec dir, slow poll pending

- **WHEN** a folder group is rendered for cwd `/project/foo` and
  `openspecMap.get("/project/foo")` returns
  `{ initialized: false, pending: true, changes: [] }`
- **THEN** the folder header SHALL render a small grey spinner where
  the `OPENSPEC (N CHANGES)` label would normally appear
- **AND** the Refresh, Archive, and Specs buttons SHALL NOT render
- **AND** the chevron SHALL NOT render
- **AND** the section SHALL NOT be expandable

#### Scenario: Folder with openspec dir transitions from pending to ready

- **WHEN** a `pending: true` spinner is showing and an
  `openspec_update` arrives for the same cwd with
  `{ initialized: true, changes: [...] }`
- **THEN** the spinner SHALL be replaced by the standard collapsed
  header (`▶ OPENSPEC (N CHANGES)` + Refresh + Archive + Specs)
  without layout shift

#### Scenario: Folder without openspec dir never spins

- **WHEN** a folder group is rendered for cwd `/project/foo` and
  `openspecMap.get("/project/foo")` returns
  `{ initialized: false, pending: false, changes: [] }`
- **THEN** no folder OpenSpec section SHALL render
- **AND** no spinner SHALL be visible at any point

### Requirement: Collapsible change list in folder section
The folder OpenSpec section SHALL be collapsed by default, showing a header line with chevron, label, change count, and action buttons. The header SHALL include a Refresh button on the left and a Specs button on the right. Clicking the header toggles expansion to show the full change list.

#### Scenario: Collapsed by default
- **WHEN** the folder OpenSpec section is first rendered
- **THEN** it SHALL show only the header line: `▶ OpenSpec (N changes)` with a Refresh button and a Specs button

#### Scenario: Expand on click
- **WHEN** the user clicks the folder OpenSpec header
- **THEN** the section SHALL expand to show all changes with PDST button and task counts, chevron changes to `▼`

#### Scenario: Collapse on click
- **WHEN** the user clicks the expanded folder OpenSpec header
- **THEN** the section SHALL collapse back to the header line only

### Requirement: Change list displays all changes with status
The expanded folder OpenSpec section SHALL list all changes, sorted with in-progress first then completed, **partitioned into group sections when at least one group is defined for the cwd**. When zero groups are defined, the list SHALL render flat as today.

Within each group section the same in-progress-first-then-completed sort SHALL apply. The implicit "Ungrouped" section is rendered last regardless of contents.

#### Scenario: Changes sorted by status
- **WHEN** the folder has changes `["done-change" (complete), "wip-change" (in-progress)]`
- **THEN** `"wip-change"` SHALL appear before `"done-change"`

#### Scenario: Changes sorted by status within a group
- **WHEN** the `UI` group has changes `["done-change" (complete), "wip-change" (in-progress)]`
- **THEN** within the `UI` section body `"wip-change"` SHALL appear before `"done-change"`

#### Scenario: Change card shows name, PDST button, session links, task count, and group picker
- **WHEN** a change `"add-auth"` has artifacts `[proposal: done, design: ready]`, 2 attached sessions, `3/8 tasks`, and is assigned to group `"ui"`
- **THEN** the change card SHALL show: `add-auth  [s1] [s2]  3/8 tasks  [PD]  [● UI ▾]` where `[● UI ▾]` is the inline group-picker chip

#### Scenario: Zero groups → flat sorted list, no group picker chip on rows
- **WHEN** `groups.length === 0`
- **THEN** the change list SHALL render flat, sorted in-progress first then complete
- **AND** rows SHALL NOT render the group-picker affordance (since no groups exist to pick)

### Requirement: Change list displays linked sessions
The expanded folder OpenSpec change list SHALL show clickable session indicators per change, displaying sessions that have `attachedProposal` matching the change name. Each linked-session row SHALL render the session name as the primary click target (jumping to that session) and SHALL render a trailing icon group exposing the session's lifecycle actions inline.

#### Scenario: Change with attached sessions
- **WHEN** change `"add-auth"` is listed in folder `/project/foo` and sessions `["s1", "s2"]` have `attachedProposal = "add-auth"`
- **THEN** the change row SHALL show clickable session names/IDs next to the change name
- **AND** each linked-session row SHALL render a trailing icon group with hide/unhide, resume (conditional), and fork (conditional) buttons

#### Scenario: Clicking session name navigates to session
- **WHEN** the user clicks the session name region in the linked-session row for `"s1"`
- **THEN** the UI SHALL navigate/scroll to session `"s1"`

#### Scenario: Change with no attached sessions
- **WHEN** change `"fix-bug"` has no sessions with `attachedProposal = "fix-bug"`
- **THEN** the change row SHALL show no session indicators

#### Scenario: Hidden attached session still appears in list with unhide icon
- **WHEN** session `"s1"` is attached to change `"add-auth"` and `s1.isHidden === true`
- **THEN** the linked-session row for `"s1"` SHALL still appear under the change
- **AND** the trailing icon group SHALL render an unhide (eye) icon
- **AND** the hide (eye-off) icon SHALL NOT render

#### Scenario: Visible attached session shows hide icon
- **WHEN** session `"s1"` is attached to change `"add-auth"` and `s1.isHidden` is false or undefined
- **THEN** the trailing icon group SHALL render a hide (eye-off) icon
- **AND** the unhide (eye) icon SHALL NOT render

#### Scenario: Resume icon visible only for resumable sessions
- **WHEN** session `"s1"` is attached to change `"add-auth"`, has `sessionFile` set, and is either not alive OR `isHidden`
- **THEN** the trailing icon group SHALL render a resume (play-circle) icon
- **WHEN** the same session is alive AND not hidden
- **THEN** the resume icon SHALL NOT render

#### Scenario: Fork icon visible whenever sessionFile exists
- **WHEN** session `"s1"` is attached to change `"add-auth"` and has `sessionFile` set
- **THEN** the trailing icon group SHALL render a fork (source-fork) icon regardless of alive/hidden state
- **WHEN** the session has no `sessionFile`
- **THEN** the fork icon SHALL NOT render

#### Scenario: Clicking a lifecycle icon does not navigate
- **WHEN** the user clicks any icon (hide, unhide, resume, fork) in the trailing icon group of a linked-session row
- **THEN** the corresponding lifecycle callback SHALL fire with the session id (and mode `"continue"` or `"fork"` for resume vs. fork)
- **AND** the session-jump navigation SHALL NOT fire (click propagation is stopped)

#### Scenario: Artifact letter colors
- **WHEN** artifacts have statuses done/ready/blocked
- **THEN** letters SHALL be green/yellow/muted respectively (same as current `OpenSpecSection`)

### Requirement: Folder-level Refresh button
The folder OpenSpec section header SHALL include a refresh button that triggers an immediate re-poll of OpenSpec data for that directory.

#### Scenario: Refresh sends openspec_refresh with cwd
- **WHEN** the user clicks the refresh button on folder `/project/foo`
- **THEN** the browser SHALL send `{ type: "openspec_refresh", cwd: "/project/foo" }`

### Requirement: Folder-level Specs button opens specs browser
The folder OpenSpec section header SHALL include a "Specs" button on the right side of the header row. Clicking it SHALL open the specs browser view in the content area for that folder's cwd.

#### Scenario: Specs button visible in header
- **WHEN** the folder OpenSpec section is rendered
- **THEN** a "Specs" button SHALL appear on the right side of the header row

#### Scenario: Specs button opens specs browser
- **WHEN** the user clicks the "Specs" button on folder `/project/foo`
- **THEN** the content area SHALL switch to the `SpecsBrowserView` showing all specs from `openspec/specs/` in cwd `/project/foo`

#### Scenario: Specs button click does not toggle collapse
- **WHEN** the user clicks the "Specs" button
- **THEN** the click SHALL NOT toggle the collapsible change list (event propagation is stopped)

### Requirement: Archive button in folder OpenSpec section
The folder OpenSpec section header SHALL include an "Archive" button next to the existing "Specs" button, visible only when OpenSpec is initialized.

#### Scenario: Archive button rendered
- **WHEN** a folder OpenSpec section is rendered with `initialized: true` and an `onOpenArchive` callback is provided
- **THEN** an "Archive" button SHALL be displayed next to the "Specs" button

#### Scenario: Archive button opens archive browser
- **WHEN** the user clicks the "Archive" button on folder `/project/foo`
- **THEN** the `ArchiveBrowserView` SHALL open in the content area for that cwd

#### Scenario: Archive button not rendered without callback
- **WHEN** the `onOpenArchive` prop is not provided
- **THEN** the "Archive" button SHALL NOT be rendered

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

### Requirement: Folder OpenSpec section renders group sections, pill row, and substring filter
When `FolderOpenSpecSection` is expanded and the cwd has at least one defined group (`groups.length >= 1`), the section body SHALL render three composing controls below the header:
1. A **pill row** with one pill per group plus a leading "All" pill plus a trailing "Manage groups…" link.
2. A **name-substring filter** `<input type="search">` matched case-insensitively against `change.name` only.
3. **Group sections** — one collapsible section per group, ordered by `group.order`, plus an implicit "Ungrouped" section rendered last.

When the cwd has zero groups, none of these three controls SHALL render and the change list SHALL render flat as today.

#### Scenario: Zero groups → flat list, no controls
- **WHEN** the folder OpenSpec section is expanded for cwd `/project/foo` and `groups.length === 0`
- **THEN** no pill row, no substring filter, and no group section headers SHALL render
- **AND** the change list SHALL render flat (sorted: incomplete first, then complete) identical to today's behavior

#### Scenario: One group → pill row + Ungrouped section + named section
- **WHEN** the section is expanded and `groups = [{ id: "ui", name: "UI", order: 0 }]` and one change is assigned to `"ui"` and one is unassigned
- **THEN** a pill row SHALL render with `[All] [UI] [Manage groups…]`
- **AND** the section SHALL show two collapsible group sections: `UI` first, `Ungrouped` second

#### Scenario: Multiple groups → ordered + Ungrouped last
- **WHEN** groups are `[{ id: "ui", order: 0 }, { id: "server", order: 1 }, { id: "build", order: 2 }]` and one change is unassigned
- **THEN** the section bodies SHALL render in order: UI, Server, Build, Ungrouped (Ungrouped always last regardless of order values)

### Requirement: Pill selection narrows visible content
The pill row SHALL display "All" + one pill per group. Selecting a pill narrows the visible content to the changes belonging to that group (or to no group, for the implicit "Ungrouped" pill if shown). The "All" pill restores the full grouped view. Pill state is local to each `FolderOpenSpecSection` (per cwd, per surface) and resets when the section is unmounted.

#### Scenario: Default pill is "All"
- **WHEN** `FolderOpenSpecSection` is freshly expanded
- **THEN** the "All" pill SHALL be active
- **AND** every group section (named + Ungrouped) SHALL be visible

#### Scenario: Selecting a named-group pill hides other sections
- **WHEN** the user clicks the "UI" pill
- **THEN** only the UI section SHALL render
- **AND** the Server, Build, and Ungrouped sections SHALL NOT render
- **AND** the selected pill SHALL be visually marked active

#### Scenario: Pill row hidden when zero groups defined
- **WHEN** `groups.length === 0`
- **THEN** the pill row SHALL NOT render
- **AND** the change list SHALL render as a flat list (no Ungrouped header either)

#### Scenario: Manage groups link opens manager
- **WHEN** the user clicks the "Manage groups…" link inside the pill row for cwd `/project/foo`
- **THEN** the `OpenSpecGroupManager` dialog SHALL open scoped to that cwd

### Requirement: Name-substring filter narrows changes within active pill
A `<input type="search">` SHALL be rendered below the pill row when the section is expanded and `groups.length >= 1`. The substring is matched case-insensitively against `change.name` only. Filter state is local to each `FolderOpenSpecSection` and resets on unmount. The filter composes with the active pill via AND: a change is visible only when it belongs to the selected pill's group AND its name contains the substring.

#### Scenario: Substring filter narrows the visible set
- **WHEN** the user types "auth" in the substring input and the active pill is "All"
- **THEN** only changes whose `name` contains "auth" (case-insensitive) SHALL render
- **AND** group sections with zero matching changes SHALL render their header but with an empty body

#### Scenario: Filter composes with pill via AND
- **WHEN** the active pill is "UI" and the user types "auth"
- **THEN** only changes assigned to group `"ui"` whose name contains "auth" SHALL render

#### Scenario: Empty filter restores full set within active pill
- **WHEN** the substring input is empty
- **THEN** every change in the active pill's scope SHALL render

#### Scenario: Filter does NOT auto-expand collapsed sections
- **WHEN** the user has collapsed the `UI` group section and types in the substring filter
- **THEN** the `UI` section SHALL remain collapsed (consistent with no-auto-expand decision)

### Requirement: Group section header shows count and group color
Each group section header SHALL display: a chevron (▶/▼), the group `name`, the count of changes in that group within the active filter scope, and a small color swatch reflecting `group.color` (or a palette default if absent). The Ungrouped section header SHALL be styled neutrally (no swatch). Headers are clickable to toggle collapse independently of pill / filter state.

#### Scenario: Header shows live count
- **WHEN** the UI group has 5 assigned changes and the substring filter narrows to 2
- **THEN** the UI section header SHALL show `▼ ● UI (2 of 5)` (or equivalent count display reflecting filtered/total)

#### Scenario: Collapse state independent of pill changes
- **WHEN** the user collapses the `UI` section, then switches the active pill to `Server`, then back to `All`
- **THEN** the `UI` section SHALL remain collapsed across the pill changes

#### Scenario: Ungrouped header has neutral styling, no swatch
- **WHEN** the Ungrouped section header renders
- **THEN** no color swatch SHALL be displayed in its header

### Requirement: Per-row group picker assigns change to a group
Each change row SHALL render a small group-picker affordance (a clickable chip showing the current group color + name, or a "+ Group" placeholder for unassigned changes). Clicking opens a dropdown listing all defined groups + a footer "Create new group…" entry. Selecting a group SHALL issue `PUT /api/openspec/groups/assignments` with `{ changeName, groupId }`. Selecting "Create new group…" SHALL inline-prompt for a name, POST a new group, then assign the change.

#### Scenario: Unassigned change shows + Group placeholder
- **WHEN** a change row is rendered for `"add-foo"` with `groupId: null`
- **THEN** the row SHALL include a "+ Group" affordance

#### Scenario: Assigned change shows current group chip
- **WHEN** a change row is rendered for `"add-foo"` with `groupId: "ui"` and group `"ui"` has `color: "#3b82f6"`
- **THEN** the row SHALL include a chip showing the UI group's name and a swatch using `#3b82f6`

#### Scenario: Selecting a group issues PUT assignment
- **WHEN** the user opens the picker on `"add-foo"` and selects `"server"`
- **THEN** the browser SHALL issue `PUT /api/openspec/groups/assignments?cwd=/project/foo` with body `{ changeName: "add-foo", groupId: "server" }`

#### Scenario: Selecting unassign clears assignment
- **WHEN** the dropdown contains an explicit "Unassign / Ungrouped" entry and the user selects it
- **THEN** the browser SHALL issue PUT with `{ changeName: "add-foo", groupId: null }`

#### Scenario: Create new group inline
- **WHEN** the user selects "Create new group…" and types `"Auth"` in the inline name input
- **THEN** the browser SHALL POST `{ name: "Auth" }`, then on success PUT the assignment to the newly returned `id`

#### Scenario: Group picker click does not toggle folder collapse
- **WHEN** the user clicks the group-picker affordance on a change row
- **THEN** event propagation SHALL be stopped
- **AND** the surrounding `FolderOpenSpecSection` collapse state SHALL be unchanged

### Requirement: Header `OpenSpec (N changes)` continues to count unfiltered total
The header label `OpenSpec (N changes)` rendered on the collapsed/expanded section header SHALL continue to count the unfiltered total number of changes for the cwd. Pill selection and substring filter SHALL NOT affect `N`.

#### Scenario: Header count unaffected by pill
- **WHEN** the cwd has 14 changes and the active pill narrows visible content to 3
- **THEN** the header label SHALL still read `OpenSpec (14 changes)`

#### Scenario: Header count unaffected by substring filter
- **WHEN** the substring filter narrows visible content to 2 of 14
- **THEN** the header label SHALL still read `OpenSpec (14 changes)`

### Requirement: Empty-state messaging when filters yield zero matches
When pill + substring filter together yield zero visible changes inside an active group section, the section body SHALL render an explicit empty-state row indicating the cause (`"No matching changes in 'UI'"` or similar). The empty state SHALL distinguish "no changes assigned to this group at all" from "filter excludes all changes in this group".

#### Scenario: Empty group with no assignments
- **WHEN** the `UI` group has zero assigned changes and substring filter is empty
- **THEN** the `UI` section body SHALL render `"No changes in this group yet"`

#### Scenario: Group has assignments but filter excludes them
- **WHEN** the `UI` group has 3 assigned changes and substring filter `"auth"` excludes all 3
- **THEN** the `UI` section body SHALL render `"No matching changes in 'UI'"` (or similar copy referencing the filter)

### Requirement: Drag-and-drop reassignment between group sections
Each change row inside the grouped view SHALL be draggable. Each `OpenSpecGroupSection` (named groups and Ungrouped) SHALL register as a drop target. Releasing a dragged change on a section different from its current group SHALL fire `PUT /api/openspec/groups/assignments` with the target group's id (or `null` for Ungrouped).

#### Scenario: Drag from named group to Ungrouped
- **WHEN** change `"add-auth"` is currently in group `"ui"` and the user drags its row onto the `Ungrouped` section header
- **THEN** the assignments map SHALL be updated to remove the `"add-auth"` entry
- **AND** the row SHALL appear under the `Ungrouped` section after the next render

#### Scenario: Drag between named groups
- **WHEN** change `"add-auth"` is in group `"ui"` and the user drags it onto the `"server"` section
- **THEN** assignments SHALL update to `{ "add-auth": "server" }`

#### Scenario: Whole row is grab target (no handle icon)
- **WHEN** rendering a change row in the grouped view
- **THEN** the entire row SHALL act as the drag handle (cursor: grab on hover)
- **AND** no separate drag-handle icon SHALL be rendered
- **AND** drag activation SHALL require an 8 px movement threshold to avoid accidental drags when clicking inner buttons

### Requirement: Per-row group picker hidden in named-group sections
Change rows rendered inside a named group section SHALL NOT render the `OpenSpecGroupPicker` chip. Rows inside the `Ungrouped` section SHALL render the picker.

#### Scenario: Row in named group hides picker
- **WHEN** change `"add-auth"` is rendered inside the `"ui"` section
- **THEN** the row SHALL NOT show the per-row group-picker chip

#### Scenario: Row in Ungrouped section shows picker
- **WHEN** change `"add-auth"` has no group assignment and is rendered inside the `Ungrouped` section
- **THEN** the row SHALL show the per-row group-picker chip

### Requirement: Ungrouped section always rendered as drop target when groups exist
When `groups.length >= 1`, the `Ungrouped` section SHALL always render. When the active pill is not `Ungrouped` and not `All`, the section header SHALL render with a collapsed body (consistent with the named-group inactive-header behavior). Clicking the header SHALL switch the active pill to `Ungrouped` and expand the body.

#### Scenario: Ungrouped header visible while UI pill active
- **WHEN** `groups.length === 2` and the active pill is `"ui"`
- **THEN** the `Ungrouped` section header SHALL be rendered with its body collapsed
- **AND** dropping a dragged change on it SHALL still trigger an unassign

### Requirement: Two-line change row layout with stacked session links
Each change row SHALL render as two lines:
- **Line 1**: change name (truncated when too long) + task count + group picker (when applicable per the requirement above) + artifact-letters button + spawn-attached button.
- **Line 2** (only when ≥1 sessions are linked to the change): each linked session button rendered full-width on its own row, stacked vertically.

#### Scenario: Single linked session renders as full-width button on line 2
- **WHEN** change `"add-auth"` has exactly 1 linked session `s1`
- **THEN** line 1 SHALL render `"add-auth"` + controls
- **AND** line 2 SHALL render a single full-width button labeled with the session name

#### Scenario: Multiple linked sessions stack vertically full-width
- **WHEN** change `"add-auth"` has 3 linked sessions
- **THEN** line 2 SHALL render 3 full-width buttons stacked top-to-bottom (not inline-wrapped)

#### Scenario: No linked sessions → line 2 omitted
- **WHEN** change `"add-auth"` has zero linked sessions
- **THEN** the row SHALL render only line 1

### Requirement: Linked-session row shows source-icon-as-status indicator
Each linked-session row in the folder OpenSpec change list SHALL render a small source-type icon (resolved from `sourceIcons[session.source]`, falling back to `mdiRobotOutline`) at the start of the row. The icon's text color SHALL mirror the dashboard's session-status palette as used by `SessionCard`'s left-gutter dot:

- `session.status === "ended"` → `text-[var(--text-muted)]`
- `session.resuming === true` → `text-yellow-500` (overrides status)
- `session.status === "streaming"` → `text-yellow-500`
- `session.status === "idle" | "active"` → `text-green-500`

The icon SHALL receive the `animate-pulse` class when AND ONLY when `session.resuming === true` OR `session.status === "streaming"`. No other states pulse the icon.

The icon SHALL be status-only — it MUST NOT consume `hasError`, `isRetrying`, `currentTool`, `unread`, or any other chat-panel signal that `FolderOpenSpecSection` does not own. The folder pill stays simpler than the full `SessionCard` derivation by design.

The row's `title` attribute and click target SHALL NOT change. Status is conveyed by the icon color and pulse alone.

#### Scenario: Idle attached session shows green agent icon, no pulse
- **WHEN** session `s1` is attached to change `add-auth` and has `status: "idle"`, `source: "dashboard"`, `resuming: false`
- **THEN** the linked-session row for `s1` SHALL render an icon with `mdiRobotOutline` (the `dashboard` source icon)
- **AND** the icon's class SHALL contain `text-green-500`
- **AND** the icon's class SHALL NOT contain `animate-pulse`

#### Scenario: Streaming attached session shows yellow pulsing icon
- **WHEN** session `s1` is attached to change `add-auth` and has `status: "streaming"`
- **THEN** the linked-session row for `s1` SHALL render the source icon with class containing `text-yellow-500`
- **AND** the icon's class SHALL contain `animate-pulse`

#### Scenario: Resuming attached session shows yellow pulsing icon regardless of status
- **WHEN** session `s1` is attached to change `add-auth` and has `resuming: true`, `status: "ended"`
- **THEN** the icon's class SHALL contain `text-yellow-500` AND `animate-pulse` (resuming overrides status)

#### Scenario: Ended attached session shows muted icon, no pulse
- **WHEN** session `s1` is attached to change `add-auth` and has `status: "ended"`, `resuming: false`
- **THEN** the icon's class SHALL contain `text-[var(--text-muted)]`
- **AND** the icon's class SHALL NOT contain `animate-pulse`

#### Scenario: ask_user attached session shows green icon, no pulse (status-only)
- **WHEN** session `s1` is attached to change `add-auth` and has `status: "idle"`, `currentTool: "ask_user"`
- **THEN** the icon's class SHALL contain `text-green-500`
- **AND** the icon's class SHALL NOT contain `animate-pulse`
- **AND** no purple "card-input-pulse" stripes SHALL render on the row (folder pill is status-only; chat-panel ask_user pulse is a `SessionCard`-only concern)

#### Scenario: Hidden attached session still receives status icon color
- **WHEN** session `s1` is attached to change `add-auth`, has `hidden: true`, `status: "streaming"`
- **THEN** the linked-session row SHALL still render the status icon with `text-yellow-500 animate-pulse`
- **AND** the existing eye-toggle (unhide) button SHALL render in the trailing icon group as today

#### Scenario: Unknown source falls back to robot icon
- **WHEN** session `s1` has a `source` value not present in `sourceIcons` (e.g. `"unknown"`)
- **THEN** the row SHALL render `mdiRobotOutline` as the status icon
- **AND** color/pulse rules SHALL apply identically

### Requirement: Linked-session row shows selection border when session is selected
The folder OpenSpec change list SHALL accept an optional `selectedId` prop (passed through from `SessionList`). For each linked-session row, when `selectedId` equals `session.id`, the row's container SHALL render with class `border-blue-500/60`. When unequal (or `selectedId` is undefined), the row SHALL render with class `border-transparent` so the row height is identical to the selected state (no layout shift on selection).

The selection style SHALL be border-only — the row MUST NOT receive a blue background tint, ring, or any other selection treatment. This deliberately diverges from `SessionCard`'s richer `border-blue-500/60 bg-blue-500/5 ring-1 ring-blue-500/30` because the row is too small to absorb ring + tint without visual crowding.

The selected row SHALL expose `data-selected="true"` for testability. Unselected rows SHALL omit the attribute (not set it to `"false"`).

#### Scenario: Selected session row carries border-blue-500/60
- **WHEN** the folder section is rendered with `selectedId: "s1"` and session `s1` is attached to change `add-auth`
- **THEN** the linked-session row for `s1` SHALL carry `data-selected="true"`
- **AND** its class SHALL contain `border-blue-500/60`
- **AND** its class SHALL NOT contain `bg-blue-500/5` or `ring-1`

#### Scenario: Unselected session row carries border-transparent
- **WHEN** the folder section is rendered with `selectedId: "s2"` and session `s1` is attached to change `add-auth` (`s1` is NOT selected)
- **THEN** the linked-session row for `s1` SHALL NOT carry `data-selected`
- **AND** its class SHALL contain `border-transparent`

#### Scenario: No selection at all
- **WHEN** the folder section is rendered with `selectedId: undefined`
- **THEN** every linked-session row SHALL render `border-transparent`
- **AND** no row SHALL carry `data-selected`

#### Scenario: Selected row height equals unselected row height
- **WHEN** two linked sessions are attached to the same change and one is `selectedId`
- **THEN** both rows SHALL render with the `border` token applied (1 px on all sides)
- **AND** their bounding-box heights SHALL be equal (no 2 px shift on selection)

#### Scenario: Selecting a session updates the border without re-mounting the row
- **WHEN** the parent re-renders with a new `selectedId` while the same change/session set is mounted
- **THEN** the previously selected row's class SHALL change from `border-blue-500/60` to `border-transparent`
- **AND** the newly selected row's class SHALL change from `border-transparent` to `border-blue-500/60`
- **AND** no other row property (testids, click handlers, lifecycle icons) SHALL change

### Requirement: Per-change worktree spawn button
Each change row in `FolderOpenSpecSection` SHALL render an optional `⑂+` icon button (mdiSourceBranchPlus) immediately to the left of the existing `▶` spawn-attached button. The button SHALL be visible only when ALL of the following hold:

- the folder is a git repository (`isGitRepo === true`),
- the global config flag `gitWorktreeEnabled` is `true` (default `true`),
- the parent passes an `onSpawnAttachedWorktree` handler.

Click SHALL invoke `onSpawnAttachedWorktree(cwd, changeName)`. The parent SHALL respond by opening `WorktreeSpawnDialog` scoped to the folder cwd, with `initialBranch = "os/<changeName>"` and `attachProposal = changeName` prefilled, so the resulting spawn carries both the new worktree path and the OpenSpec attachment intent.

The existing `▶` spawn-attached button is unchanged.

#### Scenario: Button visible on git folder with flag enabled
- **WHEN** a folder row is rendered for a git repo, `gitWorktreeEnabled` is true, and `onSpawnAttachedWorktree` is wired
- **THEN** the `⑂+` button SHALL render between the artifact-letters group and the `▶` button
- **THEN** its tooltip SHALL read `New worktree for this change`

#### Scenario: Button hidden when flag disabled
- **WHEN** `gitWorktreeEnabled` is `false`
- **THEN** the `⑂+` button SHALL NOT render for any change row, even on git folders

#### Scenario: Button hidden on non-git folder
- **WHEN** `isGitRepo` is `false` or `undefined`
- **THEN** the `⑂+` button SHALL NOT render

#### Scenario: Click forwards cwd and change name
- **WHEN** the user clicks the `⑂+` button for change `add-dark-mode` on folder `/project/foo`
- **THEN** `onSpawnAttachedWorktree("/project/foo", "add-dark-mode")` SHALL be called exactly once
- **THEN** event propagation SHALL be stopped so the surrounding row click does not also fire
