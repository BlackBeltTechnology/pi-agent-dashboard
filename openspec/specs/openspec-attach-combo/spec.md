## Purpose

Define the session card's OpenSpec attach combo box, attach dialog, workflow stepper, ChangeState pill, auto-rename behavior, and pending attach-intent plumbing that bind a session to an OpenSpec change.

## Requirements

### Requirement: Session card shows attach combo box when no proposal attached
Each session card SHALL display a `<select>` dropdown listing available changes from the folder-level OpenSpec data when the session has no attached proposal and the directory has initialized OpenSpec data. **When the user opens the searchable attach dialog (the dialog reachable from the combo box's "Browse all changes…" entry or equivalent affordance), the dialog SHALL render group sections + pill row when the cwd has at least one defined group; otherwise the dialog renders the flat list exactly as today.** The inline `<select>` combo box itself remains a flat list — group structure is exposed only inside the searchable dialog.

#### Scenario: Combo box lists available changes (flat, unchanged)
- **WHEN** session `"s1"` in cwd `/project/foo` has `attachedProposal = null` and the folder has changes `["add-auth", "fix-bug", "refactor-db"]`
- **THEN** the inline `<select>` SHALL show options: placeholder "Attach change...", "add-auth", "fix-bug", "refactor-db"
- **AND** the inline combo SHALL NOT show group structure

#### Scenario: Selecting a change sends attach_proposal
- **WHEN** the user selects `"add-auth"` from the combo box on session `"s1"`
- **THEN** the browser SHALL send `{ type: "attach_proposal", sessionId: "s1", changeName: "add-auth" }`

#### Scenario: No OpenSpec data available
- **WHEN** the session's directory has no OpenSpec data or `initialized: false`
- **THEN** no combo box SHALL be rendered

#### Scenario: No changes available
- **WHEN** OpenSpec is initialized but has zero changes
- **THEN** the combo box SHALL be rendered as disabled with placeholder text "No changes"

#### Scenario: Changes sorted in combo box (flat, unchanged)
- **WHEN** the folder has in-progress and completed changes
- **THEN** in-progress changes SHALL appear first in the combo, then completed changes

#### Scenario: Searchable dialog opens with group sections when groups defined
- **WHEN** the user opens the searchable attach dialog for cwd `/project/foo` and `groups.length >= 1`
- **THEN** the dialog SHALL render the pill row + group sections + the existing search input acting as a name-substring filter

#### Scenario: Searchable dialog renders flat when zero groups
- **WHEN** the user opens the searchable attach dialog for cwd `/project/foo` and `groups.length === 0`
- **THEN** the dialog SHALL render flat (in-progress-first sort, search input only) exactly as today

### Requirement: PDST rendered as single button navigating to proposal
The chat-view session header (desktop and mobile) SHALL render the attached change's artifact letters as a single combined button (`ArtifactLettersButton`). Each letter keeps its status color. Clicking the button navigates to the proposal artifact. The session card SHALL NOT render this button; there the lifecycle bar carries per-artifact state and navigation.

#### Scenario: Single PDST button in attached session
- **WHEN** session `"s1"` has `attachedProposal = "add-auth"` with artifacts `[proposal: done, design: ready, specs: blocked, tasks: blocked]`
- **THEN** the chat-view session header SHALL show a single clickable button containing `P D S T` with green, yellow, muted, muted colors respectively
- **AND** the session card SHALL NOT show that button

#### Scenario: Clicking PDST button opens proposal
- **WHEN** the user clicks the PDST button for change `"add-auth"`
- **THEN** `onReadArtifact("add-auth", "proposal")` SHALL be called

### Requirement: Bulk Archive button on session card when completed changes exist
The `SessionOpenSpecActions` component SHALL render a "Bulk Archive" button **only on unattached sessions** when at least one change in the folder has `status === "complete"`. Attached-session action rows SHALL NOT render a Bulk Archive button.

#### Scenario: Bulk Archive shown on unattached session when completed changes exist
- **WHEN** session `"s1"` has no attached proposal, is in cwd `/project/foo`, and the folder has changes `["done-change" (complete), "wip-change" (in-progress)]`
- **THEN** the session card SHALL show a "Bulk Archive" button alongside the attach combo box

#### Scenario: Bulk Archive hidden when no completed changes
- **WHEN** session `"s1"` has no attached proposal and all folder changes have status `in-progress` or `active`
- **THEN** no "Bulk Archive" button SHALL appear

#### Scenario: Bulk Archive hidden on attached sessions
- **WHEN** session `"s1"` has `attachedProposal = "my-change"` and the folder also contains a completed change
- **THEN** the attached-session action row SHALL NOT render a "Bulk Archive" button

#### Scenario: Bulk Archive confirmation dialog
- **WHEN** the user clicks "Bulk Archive" on an unattached session `"s1"`
- **THEN** a confirmation dialog SHALL appear with message "Bulk archive all completed changes?"

#### Scenario: Bulk Archive confirmed sends message
- **WHEN** the user confirms the Bulk Archive dialog on a session with cwd `/project/foo`
- **THEN** the browser SHALL send `{ type: "openspec_bulk_archive", cwd: "/project/foo" }`

#### Scenario: Bulk Archive cancelled
- **WHEN** the user cancels the Bulk Archive dialog
- **THEN** no action SHALL be taken

#### Scenario: Bulk Archive disabled when streaming
- **WHEN** unattached session `"s1"` has `status = "streaming"` and completed changes exist
- **THEN** the "Bulk Archive" button SHALL be shown but disabled

### Requirement: Mobile session header shows attached-proposal chip
On mobile viewports, the session header SHALL render a paperclip-prefixed chip displaying `session.attachedProposal` whenever that field is non-empty. When the chip is rendered, the mobile session header SHALL use a **two-row layout**: When the attachment does not resolve `kind: "active"` with the resolved cwd equal to `session.cwd` (see `openspec-attachment-resolution`), the chip content additionally follows "Archived or missing attachment renders a traceable header".

- **Row 1**: back button (when applicable), session title (which now claims the full available width of row 1, no longer competing with the chip), `MobileAttachButton` (paperclip icon + popover), and `MobileActionMenu` (kebab).
- **Row 2**: the attached-proposal chip — paperclip icon, change name, `ArtifactLettersButton` pill (when `openspecChanges` matches), and `attached-proposal-task-counter` (when `totalTasks > 0`).

When `session.attachedProposal` is `null`, `undefined`, or empty string, the mobile session header SHALL render as a single row exactly as before — there is no empty second row reserved.

The chip remains visually distinct (blue accent) and continues to degrade gracefully on narrow widths via truncation with the full change name available as a `title` attribute. The chip SHALL be read-only — action affordances (attach, detach) remain in the existing `MobileAttachButton` popover.

#### Scenario: Attached proposal is rendered as a chip on row 2
- **WHEN** the viewport is mobile and `session.attachedProposal === "add-auth"`
- **THEN** the mobile session header SHALL render with a `flex-col` (two-row) container
- **AND** row 1 SHALL contain the session title, `MobileAttachButton`, and `MobileActionMenu`
- **AND** row 2 SHALL contain the chip with the paperclip icon and the text `add-auth`
- **AND** the chip SHALL carry `data-testid="mobile-header-attached-chip"`
- **AND** the chip SHALL NOT be a child of the same row as the session title

#### Scenario: No attached proposal hides the chip and keeps a single row
- **WHEN** the viewport is mobile and `session.attachedProposal` is `null`, `undefined`, or empty string
- **THEN** the mobile session header SHALL render as a single-row container (no `flex-col` wrapper, no empty second row)
- **AND** the chip SHALL NOT be present in the DOM

#### Scenario: Long change name is truncated with full text in tooltip
- **WHEN** the viewport is mobile and `session.attachedProposal` is a string longer than the chip's row-2 width
- **THEN** the visible chip text SHALL be truncated with CSS ellipsis
- **AND** the chip's `title` attribute SHALL contain the full change name prefixed with `Attached: `

#### Scenario: Chip updates reactively on session_updated
- **WHEN** the server broadcasts `session_updated` with `updates.attachedProposal = "feature-x"`
- **THEN** the mobile session header SHALL re-render as a two-row layout with `feature-x` in the row-2 chip within the next paint frame
- **WHEN** the server broadcasts `session_updated` with `updates.attachedProposal = null`
- **THEN** the mobile session header SHALL collapse back to a single-row layout and the chip SHALL be removed from the DOM

#### Scenario: Session name claims full row-1 width
- **WHEN** the viewport is 360px wide on mobile and `session.attachedProposal === "add-extension-ui-decorations"`
- **THEN** the row-1 session-title `<span>` SHALL have access to all horizontal space between the back button and the `MobileAttachButton` + `MobileActionMenu` group
- **AND** the title SHALL NOT be constrained by the chip's previous `max-w-[55%]` (which only applied when chip and title shared a row)

### Requirement: Mobile session card shows attached-proposal chip
On mobile viewports, each session card SHALL render a paperclip-prefixed chip displaying `session.attachedProposal` whenever that field is non-empty. The chip SHALL coexist with `OpenSpecActivityBadge` (which reads the distinct `openspecPhase` / `openspecChange` fields) — both MAY render simultaneously and MUST NOT visually collide. When the attachment does not resolve `kind: "active"` with the resolved cwd equal to `session.cwd` (see `openspec-attachment-resolution`), the chip content additionally follows "Archived or missing attachment renders a traceable header".

#### Scenario: Attached proposal is rendered as a card chip
- **WHEN** the viewport is mobile and `session.attachedProposal === "add-auth"`
- **THEN** the mobile session card SHALL render a chip with the paperclip icon and the text `add-auth`
- **AND** the chip SHALL carry `data-testid="mobile-card-attached-chip"`

#### Scenario: Coexistence with OpenSpec activity badge
- **WHEN** a mobile session card has both `attachedProposal: "add-auth"` and `openspecPhase: "applying"` with `openspecChange: "fix-bug"`
- **THEN** both `mobile-card-attached-chip` and the `OpenSpecActivityBadge` SHALL render
- **AND** the two SHALL be visually distinguishable (the attached chip is blue with the change name; the activity badge carries phase + count semantics)

#### Scenario: No attached proposal hides the chip
- **WHEN** the viewport is mobile and `session.attachedProposal` is null, undefined, or empty
- **THEN** the mobile session card SHALL NOT render the attached-proposal chip

### Requirement: Idempotent auto-rename on attach
When a browser sends `attach_proposal`, the server SHALL set `session.name = changeName` if EITHER the current name is empty/whitespace OR the current name equals the current `session.attachedProposal` (i.e. the name was previously auto-set by an earlier attach and the user has not customised it). When the name was auto-set, the server SHALL forward `rename_session` to the bridge so pi's session name is kept in sync.

#### Scenario: Fresh session — name auto-set on first attach
- **WHEN** session has `name: undefined` and `attachedProposal: null`
- **AND** the browser sends `attach_proposal { changeName: "add-auth" }`
- **THEN** the server SHALL update `session.name = "add-auth"` and `session.attachedProposal = "add-auth"`
- **AND** the server SHALL send `rename_session { name: "add-auth" }` to the bridge
- **AND** the server SHALL broadcast `session_updated` with `updates = { attachedProposal: "add-auth", name: "add-auth" }`

#### Scenario: Custom-named session — name preserved on attach
- **WHEN** session has `name: "my custom"` and `attachedProposal: null`
- **AND** the browser sends `attach_proposal { changeName: "add-auth" }`
- **THEN** the server SHALL update `session.attachedProposal = "add-auth"` only
- **AND** `session.name` SHALL remain `"my custom"`
- **AND** no `rename_session` SHALL be sent to the bridge

#### Scenario: Re-attach after auto-rename — name re-tracks new change
- **WHEN** session has `name: "foo"` and `attachedProposal: "foo"` (auto-set on a previous attach)
- **AND** the browser sends `attach_proposal { changeName: "bar" }`
- **THEN** the server SHALL update `session.name = "bar"` and `session.attachedProposal = "bar"`
- **AND** the server SHALL send `rename_session { name: "bar" }` to the bridge

#### Scenario: User-customised name — never override on re-attach
- **WHEN** session has `name: "my custom"` and `attachedProposal: "foo"` (user customised after auto-rename)
- **AND** the browser sends `attach_proposal { changeName: "bar" }`
- **THEN** the server SHALL update `session.attachedProposal = "bar"` only
- **AND** `session.name` SHALL remain `"my custom"`
- **AND** no `rename_session` SHALL be sent to the bridge

### Requirement: Idempotent auto-rename revert on detach
When a browser sends `detach_proposal`, the server SHALL clear `session.name` (set to `undefined`) if and only if the current `session.name` equals the current `session.attachedProposal` (i.e. the name was auto-set on a previous attach). When the name was auto-cleared, the server SHALL forward `rename_session` with an empty name to the bridge so pi's session name is reset.

#### Scenario: Auto-set name reverted on detach
- **WHEN** session has `name: "foo"` and `attachedProposal: "foo"`
- **AND** the browser sends `detach_proposal`
- **THEN** the server SHALL update `session.name = undefined`, `session.attachedProposal = null`, `session.openspecPhase = null`, `session.openspecChange = null`
- **AND** the server SHALL send `rename_session { name: "" }` to the bridge
- **AND** the broadcast `session_updated` payload SHALL contain `updates.name = undefined` so the client falls back to `firstMessage` / cwd basename

#### Scenario: User-customised name preserved on detach
- **WHEN** session has `name: "my custom"` and `attachedProposal: "foo"`
- **AND** the browser sends `detach_proposal`
- **THEN** the server SHALL update `session.attachedProposal = null`, `session.openspecPhase = null`, `session.openspecChange = null`
- **AND** `session.name` SHALL remain `"my custom"`
- **AND** no `rename_session` SHALL be sent to the bridge

#### Scenario: Already-empty name unchanged on detach
- **WHEN** session has `name: undefined` and `attachedProposal: "foo"`
- **AND** the browser sends `detach_proposal`
- **THEN** the server SHALL update `attachedProposal: null`, `openspecPhase: null`, `openspecChange: null`
- **AND** `session.name` SHALL remain `undefined`
- **AND** no `rename_session` SHALL be sent to the bridge

#### Scenario: Name set with no attachment is preserved on a defensive detach
- **WHEN** session has `name: "foo"` and `attachedProposal: null` (defensive: no auto-set witness)
- **AND** the browser sends `detach_proposal`
- **THEN** the server SHALL update `attachedProposal: null`, `openspecPhase: null`, `openspecChange: null`
- **AND** `session.name` SHALL remain `"foo"`
- **AND** no `rename_session` SHALL be sent to the bridge

### Requirement: Idempotent auto-rename on auto-detected attach
When the OpenSpec activity detector emits a `changeName` from a `tool_execution_start` event with `isActive: true` (write/CLI activity, not passive reads), the server SHALL apply the same idempotent witness rule used for browser-initiated `attach_proposal`. Specifically, the server SHALL re-attach the session to the detected `changeName` when EITHER the session has no current `attachedProposal` OR the current `attachedProposal` equals the current `session.name` (i.e. the previous attachment was auto-tracked) AND the detected `changeName` differs from the current `attachedProposal`.

The inner rename guard SHALL match the rule defined in `Idempotent auto-rename on attach`: rename the session when its current name is empty/whitespace OR equals the current `attachedProposal`. When the rename guard does not fire, the server SHALL NOT send a `rename_session` message to the bridge.

#### Scenario: Fresh session — auto-detect attaches and auto-names
- **WHEN** session has `name: undefined`, `attachedProposal: null`, `openspecChange: null`
- **AND** the activity detector emits `{ changeName: "bar", isActive: true }`
- **THEN** the server SHALL update `session.attachedProposal = "bar"` and `session.name = "bar"`
- **AND** the server SHALL send `rename_session { name: "bar" }` to the bridge

#### Scenario: Auto-tracked attachment re-attaches when a different changeName is detected
- **WHEN** session has `name: "foo"`, `attachedProposal: "foo"` (auto-tracked from a previous detection)
- **AND** the activity detector emits `{ changeName: "bar", isActive: true }`
- **THEN** the server SHALL update `session.attachedProposal = "bar"` and `session.name = "bar"`
- **AND** the server SHALL send `rename_session { name: "bar" }` to the bridge

#### Scenario: User-customised name — openspecChange tracks reality, attachment preserved
- **WHEN** session has `name: "my custom"`, `attachedProposal: "foo"`, `openspecChange: "foo"`
- **AND** the activity detector emits `{ changeName: "bar", isActive: true }`
- **THEN** the server SHALL update `session.openspecChange = "bar"` (so the activity badge tracks reality)
- **AND** `session.attachedProposal` SHALL remain `"foo"` (user has overridden the auto-tracking)
- **AND** `session.name` SHALL remain `"my custom"`
- **AND** no `rename_session` SHALL be sent to the bridge

#### Scenario: Already-converged state — no redundant rename
- **WHEN** session has `name: "bar"`, `attachedProposal: "bar"`, `openspecChange: "bar"`
- **AND** the activity detector emits `{ changeName: "bar", isActive: true }`
- **THEN** the server SHALL NOT send `rename_session` to the bridge
- **AND** the broadcast `session_updated` payload SHALL NOT include a `name` field for this update (no redundant rebroadcast)

### Requirement: spawn_session message accepts optional attachProposal
The `SpawnSessionBrowserMessage` interface in the browser↔server protocol SHALL accept an optional `attachProposal?: string` field. The field SHALL be the kebab-case name of an existing OpenSpec change in the spawn target's `cwd`. Clients omitting the field MUST receive identical behaviour to the field being absent (bare spawn).

#### Scenario: Field is optional and additive
- **WHEN** a client sends `{ type: "spawn_session", cwd: "/project/foo" }` (no `attachProposal`)
- **THEN** the server SHALL spawn a pi session in `/project/foo` exactly as it does today
- **THEN** no attach intent SHALL be queued

#### Scenario: Field carries the change name when present
- **WHEN** a client sends `{ type: "spawn_session", cwd: "/project/foo", attachProposal: "add-auth" }`
- **THEN** the server SHALL spawn a pi session in `/project/foo`
- **THEN** the server SHALL queue a pending-attach intent for `cwd = "/project/foo"`, `changeName = "add-auth"`

#### Scenario: Backward compat — old server, new client
- **WHEN** a new client sending `attachProposal` connects to an old server that ignores unknown fields
- **THEN** the spawn SHALL succeed unattached
- **THEN** the user SHALL be able to attach manually via the existing attach UI

### Requirement: Server queues pending attach intents per cwd
The dashboard server SHALL maintain an in-memory `pendingAttachByCwd: Map<string, PendingAttach[]>` where `PendingAttach = { changeName: string, enqueuedAt: number }`. Receiving a `spawn_session` with `attachProposal` SHALL push to the queue for the normalized cwd. The map SHALL be in-memory only and SHALL NOT be persisted across server restarts.

#### Scenario: Single intent enqueued
- **WHEN** the server handles `spawn_session { cwd: "/project/foo", attachProposal: "add-auth" }`
- **THEN** `pendingAttachByCwd.get("/project/foo")` SHALL contain one entry with `changeName = "add-auth"`

#### Scenario: Multiple intents preserve FIFO order
- **WHEN** the server handles three `spawn_session` calls in order with `attachProposal` values `"a"`, `"b"`, `"c"` for the same cwd
- **THEN** the queue for that cwd SHALL contain `[a, b, c]` in that order

#### Scenario: Cwd is normalized before keying the queue
- **WHEN** two `spawn_session` calls arrive with `cwd = "/project/foo"` and `cwd = "/project/foo/"` (trailing slash) and the same `attachProposal`
- **THEN** both intents SHALL land in the same queue (the path is normalized before lookup)

#### Scenario: Per-cwd queue is bounded
- **WHEN** a 9th `attachProposal` is enqueued for the same cwd while 8 are already queued
- **THEN** the 9th SHALL be silently dropped
- **THEN** the server SHALL log a warning citing the cwd and queue cap

#### Scenario: Stale intents expire after 60 seconds
- **WHEN** an intent has been in the queue for more than 60 seconds and any read or write touches that cwd's queue
- **THEN** the stale entry SHALL be discarded before the operation proceeds
- **THEN** the server SHALL log a warning citing the discarded changeName

### Requirement: Pending intent is consumed on session_register
When the pi-gateway receives a `session_register` from a bridge, after the session is registered with the session manager the server SHALL look up `pendingAttachByCwd` for the registered session's normalized cwd, pop the head entry (if any), and apply the same idempotent attach logic as `handleAttachProposal` — including `attachRenameTarget(...)` rename — to the newly registered `sessionId`.

#### Scenario: Intent matches and is consumed
- **GIVEN** the server has `pendingAttachByCwd.get("/project/foo") = [{changeName: "add-auth", ...}]`
- **WHEN** a `session_register` arrives with `sessionId = "s99"` and `cwd = "/project/foo"`
- **THEN** after `sessionManager.register(...)`, the server SHALL pop the head entry
- **THEN** the server SHALL update the session with `attachedProposal = "add-auth"` and broadcast `session_updated`
- **THEN** if `attachRenameTarget(session, "add-auth")` returns a non-undefined name, the server SHALL also send `rename_session` to the bridge and include `name` in the broadcast

#### Scenario: No intent — no-op
- **GIVEN** the queue for the registering cwd is empty or absent
- **WHEN** a `session_register` arrives
- **THEN** the server SHALL behave exactly as it does today (no attach, no rename)

#### Scenario: Only one intent consumed per register
- **GIVEN** `pendingAttachByCwd.get("/project/foo") = [{changeName: "a", ...}, {changeName: "b", ...}]`
- **WHEN** a single `session_register` for `/project/foo` arrives
- **THEN** only the head entry (`"a"`) SHALL be consumed and applied
- **THEN** `"b"` SHALL remain at the head of the queue for the next matching register

#### Scenario: Cwd normalization on consume
- **GIVEN** an intent was enqueued under the normalized key `/project/foo`
- **WHEN** a `session_register` arrives with cwd `/project/foo/` (trailing slash) or a symlink path resolving to the same realpath
- **THEN** the queue lookup SHALL find and consume the intent

#### Scenario: Failed spawn does not strand the queue forever
- **GIVEN** a spawn failed and no `session_register` ever arrives for that cwd
- **WHEN** 60 seconds elapse and any later intent is enqueued or consumed for that cwd
- **THEN** the stranded intent SHALL be dropped per the staleness rule above
- **THEN** the next successful register SHALL NOT inherit the stranded intent

### Requirement: Attach dialog renders group sections and pill row when groups defined
When the searchable attach dialog is opened from `SessionOpenSpecActions` for a session whose cwd has `groups.length >= 1`, the dialog body SHALL render a pill row above the existing search input plus collapsible group sections in the change list. The pill row SHALL contain "All" plus one pill per group plus the trailing "Manage groups…" link. Group sections SHALL be ordered by `group.order` with the implicit "Ungrouped" section rendered last. When the cwd has zero groups, the dialog renders exactly as today (flat list, in-progress-first sort, existing search input only).

#### Scenario: Zero groups → today's layout
- **WHEN** the attach dialog opens for session `"s1"` in cwd `/project/foo` and `groups.length === 0`
- **THEN** no pill row SHALL render
- **AND** no group section headers SHALL render
- **AND** the change list SHALL render flat sorted in-progress first then complete

#### Scenario: One+ groups → pill row + group sections
- **WHEN** the attach dialog opens for cwd `/project/foo` and at least one group is defined
- **THEN** a pill row SHALL render with `[All] [<group>...] [Manage groups…]`
- **AND** the change list SHALL partition into one collapsible section per group (in `group.order`) plus an `Ungrouped` section last

### Requirement: Existing dialog search input becomes the unified name-substring filter
The searchable attach dialog's existing search input SHALL act as the name-substring filter when groups are present, composing with the active pill via AND. The dialog's search behavior is otherwise unchanged.

#### Scenario: Search composes with pill via AND
- **WHEN** the user types `"auth"` in the dialog search input and the active pill is `UI`
- **THEN** only changes assigned to group `"ui"` whose names contain `"auth"` SHALL render

#### Scenario: Search continues to work when zero groups
- **WHEN** `groups.length === 0` and the user types `"auth"`
- **THEN** the search SHALL filter the flat list exactly as today

### Requirement: Selecting a change from any group attaches it
Selecting a change from any group section SHALL issue the same `attach_proposal` browser message as today (`{ type: "attach_proposal", sessionId, changeName }`). Group membership has no effect on the attach action itself.

#### Scenario: Attach from named group section
- **WHEN** the user selects change `"add-auth"` from the `UI` group section in the attach dialog for session `"s1"`
- **THEN** the browser SHALL send `{ type: "attach_proposal", sessionId: "s1", changeName: "add-auth" }`

#### Scenario: Attach from Ungrouped section
- **WHEN** the user selects change `"fix-bug"` from the `Ungrouped` section in the attach dialog
- **THEN** the browser SHALL send `attach_proposal` exactly as if no grouping existed

### Requirement: Per-row group picker NOT exposed inside attach dialog
The per-row group-picker affordance (chip / dropdown that reassigns a change to a different group) defined for the folder view SHALL NOT be rendered inside the attach dialog. Reassignment is a folder-level concern; the attach dialog is for selection only.

#### Scenario: No group picker on rows in attach dialog
- **WHEN** the attach dialog is rendered with at least one group defined
- **THEN** no group-picker chip / dropdown SHALL render on any change row inside the dialog
- **AND** group sections SHALL still render (selection-only experience)

### Requirement: Pill state local to dialog instance
Pill selection in the attach dialog SHALL be local to that dialog instance and SHALL reset when the dialog closes. Re-opening the dialog SHALL default to the "All" pill.

#### Scenario: Pill resets on dialog close/reopen
- **WHEN** the user opens the dialog, selects the `UI` pill, closes the dialog, and re-opens it
- **THEN** the dialog SHALL re-open with the "All" pill active

#### Scenario: Pill state independent of folder view
- **WHEN** the folder view's pill is set to `Server` and the user opens the attach dialog
- **THEN** the dialog SHALL open with the "All" pill active, independent of the folder view

### Requirement: Active session shows + Change and Explore only when unattached
When a session is active (not ended) and has no attached proposal, the `SessionOpenSpecActions` component SHALL render a "+ Change" button and an enabled "Explore" button inline next to the attach combo box, each subject to the folder's workflow configuration. When a session has an attached proposal, neither "+ Change" nor an inline "Explore" button SHALL render. Change-scoped Explore is offered in the `⋯` menu instead (see `Attached session header shows one primary action and an overflow menu`).

#### Scenario: Active session with no attachment shows enabled Explore
- **WHEN** session `"s1"` has `status = "active"` and `attachedProposal = null`
- **THEN** the session card SHALL show the attach combo box, a "+ Change" button, and an enabled "Explore" button in a single row

#### Scenario: + Change opens NewChangeDialog
- **WHEN** the user clicks "+ Change" on session `"s1"`
- **THEN** a `NewChangeDialog` SHALL open

#### Scenario: + Change sends prompt to its own session
- **WHEN** the user fills in the NewChangeDialog and clicks Send on session `"s1"`
- **THEN** the `/opsx:new` prompt SHALL be sent via `onSendPrompt` to session `"s1"`

#### Scenario: Explore opens ExploreDialog with no change name
- **WHEN** the user clicks "Explore" on session `"s1"` with no attached proposal
- **THEN** an `ExploreDialog` SHALL open with an empty change name for general explore mode

#### Scenario: Attached session shows no inline Explore or + Change
- **WHEN** session `"s1"` has `attachedProposal = "add-auth"`
- **THEN** no inline "Explore" button and no "+ Change" button SHALL render

#### Scenario: Ended session hides + Change and Explore
- **WHEN** session `"s1"` has `status = "ended"` and `attachedProposal = null`
- **THEN** neither "+ Change" nor "Explore" buttons SHALL be rendered

### Requirement: Lifecycle bar inside attached session card
When a session has an `attachedProposal` AND the corresponding `OpenSpecChange` is present in the folder's OpenSpec data, the session card SHALL render a **lifecycle bar** directly below the attached-change header row. The bar SHALL contain exactly five segments, left to right: `Proposal`, `Design`, `Specs`, `Tasks`, `Archive`. There SHALL be no `Explore` segment and no separate `Apply` segment. The bar SHALL be exposed to assistive technology as a labelled group ("OpenSpec lifecycle").

Each segment SHALL be one interactive-or-inert unit made of a horizontal track and a text label below it. Its total height SHALL be at least 24 CSS px. The `Tasks` segment SHALL take the remaining width. The other segments SHALL size to their label. Inert segments SHALL NOT be focusable.

Each segment SHALL render in one of four states — `done`, `current`, `todo`, `skipped`. The states derive from `(change.artifacts, change.completedTasks, change.totalTasks, deriveChangeState(change))`:

- `Proposal`, `Design`, `Specs`:
  - `done` when the artifact's status is `done`;
  - `skipped` when it is `skipped`;
  - `current` when it is `ready`;
  - `todo` when it is `blocked` or the artifact is absent.
- `Tasks`:
  - `done` when `deriveChangeState === COMPLETE`;
  - `current` when `deriveChangeState` is `READY` or `IMPLEMENTING`, even when every task is already ticked;
  - `todo` when it is `PLANNING`.
- `Archive`: `current` when `deriveChangeState === COMPLETE`; `todo` otherwise.

The number of `current` segments:
- In `READY`, `IMPLEMENTING` and `COMPLETE`, exactly one segment SHALL be `current`.
- In `PLANNING`, every artifact whose status is `ready` is `current`. More than one MAY be current, because several artifacts can be authorable at once.

Segment state SHALL be presented through the shared status primitive:
- the primitive's semantic token for `done` / `current` / `todo`;
- `skipped` uses the `done` token with a dash glyph and a hatched track.

State SHALL NOT be conveyed by color alone:
- `done` labels SHALL carry a check glyph;
- `skipped` labels SHALL carry a dash glyph;
- the `current` label SHALL render at a heavier font weight.

A `current` non-Tasks segment MAY pulse. The pulse SHALL stop under `prefers-reduced-motion: reduce`.

When `totalTasks > 0`, the `Tasks` segment label SHALL show `<completed>/<total>`. Its track SHALL fill from the left in proportion to `completedTasks / totalTasks`. When `totalTasks === 0` the label SHALL show `Tasks —` and the segment SHALL be inert.

When the bar's own width is below 250 CSS px, the segment labels SHALL collapse to single letters (`P`, `D`, `S`, `A`). The Tasks segment SHALL keep the `<completed>/<total>` count.

Every segment SHALL expose an accessible name that includes the artifact or phase and its state. Examples: "Design, current", "Tasks 12 of 39 done".

Clicking a segment:
- `Proposal` / `Design` / `Specs` SHALL open that artifact.
- `Tasks` SHALL open the tasks list when `totalTasks > 0` and the session is not `streaming`. The tasks list can toggle checkboxes, so it is locked while the agent may be rewriting `tasks.md`.
- `Archive` SHALL open the archive confirm dialog only when the host surface enables it. On the session card that means `deriveChangeState === COMPLETE`, session neither `streaming` nor `ended`, and the archive workflow enabled. Otherwise it SHALL be inert.

`Proposal`, `Design` and `Specs` segments SHALL remain clickable while the session is `streaming` or `ended`, because they open read-only previews. The `Tasks` segment SHALL be inert while `streaming` and clickable when `ended`. Clicks on a segment SHALL NOT bubble to the enclosing card.

The bar SHALL also exist in a `compact` variant:
- it renders the identical segments, states and click-to-open behavior;
- it renders no primary action and no `⋯` menu;
- its `Archive` segment is always inert.

The OpenSpec board card uses the compact variant.

#### Scenario: Implementing change renders five segments with a filled Tasks track
- **WHEN** session `"s1"` is attached to `"add-auth"` with proposal/design/specs `done`, `completedTasks = 12`, `totalTasks = 39`, and `deriveChangeState` returns `IMPLEMENTING`
- **THEN** the bar SHALL render segments `Proposal`, `Design`, `Specs`, `Tasks`, `Archive` in that order
- **AND** `Proposal`, `Design`, `Specs` SHALL be `done`, `Tasks` SHALL be `current` with label `12/39` and a ~31 % fill, and `Archive` SHALL be `todo`
- **AND** no `Explore` or `Apply` segment SHALL render

#### Scenario: Only one current segment while implementing
- **WHEN** `deriveChangeState` returns `IMPLEMENTING`
- **THEN** exactly one segment (`Tasks`) SHALL be in the `current` state

#### Scenario: All tasks ticked but change not complete keeps Tasks current
- **WHEN** `deriveChangeState` returns `IMPLEMENTING` with `completedTasks = totalTasks = 39`
- **THEN** `Tasks` SHALL be `current` with a full fill
- **AND** `Archive` SHALL be `todo`

#### Scenario: Planning with two authorable artifacts shows two current segments
- **WHEN** `deriveChangeState` returns `PLANNING` with `proposal: done`, `design: ready`, `specs: ready`
- **THEN** both `Design` and `Specs` SHALL be `current`
- **AND** `Tasks` and `Archive` SHALL be `todo`

#### Scenario: Skipped specs render distinctly from done
- **WHEN** the change's `specs` artifact has status `skipped`
- **THEN** the `Specs` segment SHALL render in the `skipped` state with a dash glyph and a hatched track

#### Scenario: Clicking an artifact segment opens the artifact
- **WHEN** the user clicks the `Design` segment for change `"add-auth"`
- **THEN** the `design` artifact of `"add-auth"` SHALL open

#### Scenario: Artifact segments stay clickable while streaming
- **WHEN** the session is `streaming` and the user clicks the `Proposal` segment
- **THEN** the `proposal` artifact SHALL open

#### Scenario: Tasks segment inert while streaming
- **WHEN** the session is `streaming`, `totalTasks = 39`, and the user clicks the `Tasks` segment
- **THEN** the tasks list SHALL NOT open

#### Scenario: Clicking Archive segment on a complete change opens archive confirm
- **WHEN** `deriveChangeState` returns `COMPLETE`, the session is idle, and the user clicks the `Archive` segment
- **THEN** the archive confirm dialog SHALL open for the attached change

#### Scenario: Archive segment inert before completion
- **WHEN** `deriveChangeState` returns `IMPLEMENTING` and the user clicks the `Archive` segment
- **THEN** no dialog SHALL open and no prompt SHALL be sent

#### Scenario: Narrow bar collapses labels to letters
- **WHEN** the bar renders in a container narrower than 250 CSS px
- **THEN** the `Proposal`, `Design`, `Specs`, `Archive` labels SHALL render as `P`, `D`, `S`, `A`
- **AND** the `Tasks` segment SHALL still show `<completed>/<total>`

#### Scenario: Segment hit target meets minimum size
- **WHEN** the bar renders in the session card
- **THEN** every interactive segment's hit area SHALL be at least 24 CSS px tall

### Requirement: Attached session header shows one primary action and an overflow menu
When a session has an `attachedProposal`, the session card SHALL show one header row:
- the attached change name as a badge, name in `text-blue-400`;
- then, right-aligned, at most **one primary action button**;
- then a `⋯` overflow button.

The header row SHALL NOT contain a state pill, an inline Explore button, or a standalone Detach button.

Every action below is subject to the folder's OpenSpec workflow configuration. An action whose workflow is disabled SHALL NOT render anywhere. Detach is not a workflow and is never gated.

The primary action is the first enabled candidate for the current `deriveChangeState`:
- `PLANNING` → **Continue** (sends `/skill:openspec-continue-change <name>`), else **Fast-forward** (sends `/skill:openspec-ff-change <name>`).
- `READY` or `IMPLEMENTING` → **Apply** (sends `/skill:openspec-apply-change <name>`).
- `COMPLETE` → **Archive** (opens the archive confirm dialog; confirming sends `/skill:openspec-archive-change <name>`), else **Verify** (sends `/skill:openspec-verify-change <name>`).

When no candidate is enabled, no primary button SHALL render.

The `⋯` menu SHALL contain, in order and only when applicable and enabled:
- **Fast-forward** — when `PLANNING` and it is not the primary;
- **Verify** — when `COMPLETE` and it is not the primary;
- **Archive anyway…** — when `IMPLEMENTING` AND `change.isComplete === true` AND every artifact is `done` or `skipped`;
- **Explore…** — in every non-ended state where the change is present (gated by the `explore` workflow). It opens the `ExploreDialog` for the attached change, and submitting sends `/skill:openspec-explore <name>\n<text>`;
- a divider, then **Detach** — always.

No disabled Archive button SHALL render in any state.

While the session is `streaming`:
- the primary action SHALL be rendered `aria-disabled` with tooltip "Session is streaming";
- every `⋯` item except **Detach** SHALL be disabled.

While the session is `ended`:
- the primary action SHALL be hidden;
- the `⋯` menu SHALL render with **Detach** as its only item, so an ended session can still be detached.

Activating a `⋯` item SHALL NOT select, navigate to, or drag the enclosing session card or board card, even though the menu is portalled. Each `⋯` item SHALL display its MDI icon, as the inline buttons do today.

The `⋯` menu SHALL open on click or on keyboard activation. On open, focus SHALL move to its first enabled item. Escape or an outside click SHALL close it and return focus to the `⋯` button.

This requirement applies wherever the session OpenSpec block is mounted, including the per-session OpenSpec panel on board cards.

This requirement governs attachments that resolve `kind: "active"` with the resolved cwd equal to `session.cwd` (see `openspec-attachment-resolution`). Attachments that resolve `archived` or `missing` render per "Archived or missing attachment renders a traceable header" instead.

#### Scenario: PLANNING shows Continue as primary
- **WHEN** session `"s1"` is attached to `"add-auth"`, `deriveChangeState` returns `PLANNING`, and all workflows are enabled
- **THEN** the header row SHALL show the badge, a **Continue** button, and a `⋯` button
- **AND** the `⋯` menu SHALL contain **Fast-forward**, **Explore…** and **Detach**
- **AND** no inline Explore, no Archive and no state pill SHALL render

#### Scenario: Core workflow profile without continue falls back or omits primary
- **WHEN** `deriveChangeState` returns `PLANNING` and the workflow configuration enables neither `continue` nor `ff`
- **THEN** no primary button SHALL render
- **AND** the `⋯` menu SHALL contain **Explore…** (when `explore` is enabled) and **Detach**, and no Fast-forward

#### Scenario: READY and IMPLEMENTING show Apply as primary
- **WHEN** `deriveChangeState` returns `READY` or `IMPLEMENTING`
- **THEN** the primary button SHALL be **Apply**
- **AND** clicking it SHALL send `/skill:openspec-apply-change add-auth` to session `"s1"`

#### Scenario: COMPLETE shows Archive as primary and Verify in overflow
- **WHEN** `deriveChangeState` returns `COMPLETE` and all workflows are enabled
- **THEN** the primary button SHALL be **Archive**
- **AND** the `⋯` menu SHALL contain **Verify**, **Explore…** and **Detach**
- **AND** clicking **Verify** SHALL send `/skill:openspec-verify-change add-auth`

#### Scenario: Archive anyway offered in overflow
- **WHEN** `deriveChangeState` returns `IMPLEMENTING`, `change.isComplete === true`, and every artifact is `done` or `skipped`
- **THEN** the `⋯` menu SHALL contain **Archive anyway…**
- **AND** selecting it SHALL open a confirm dialog with message "N of M tasks are unchecked. Archive anyway?"
- **AND** confirming SHALL send `/skill:openspec-archive-change add-auth`

#### Scenario: Archive anyway not offered when isComplete is not true
- **WHEN** the change is `IMPLEMENTING` and `change.isComplete !== true`
- **THEN** the `⋯` menu SHALL NOT contain **Archive anyway…**

#### Scenario: Explore from overflow is change-scoped
- **WHEN** session `"s1"` is attached to `"add-auth"` and the user selects **Explore…** from `⋯` and submits `what does step 3 mean?`
- **THEN** `/skill:openspec-explore add-auth\nwhat does step 3 mean?` SHALL be sent to session `"s1"`

#### Scenario: Detach from overflow clears attachment
- **WHEN** the user selects **Detach** from the `⋯` menu on session `"s1"`
- **THEN** the browser SHALL send `{ type: "detach_proposal", sessionId: "s1" }`
- **AND** the attach combo SHALL reappear

#### Scenario: Streaming disables primary and overflow actions except Detach
- **WHEN** session `"s1"` is attached and `status = "streaming"`
- **THEN** the primary button SHALL be `aria-disabled` with `title="Session is streaming"`
- **AND** every `⋯` item except **Detach** SHALL be disabled

#### Scenario: Ended session keeps Detach reachable
- **WHEN** session `"s1"` is attached, the attachment resolves `kind: "active"`, and `status = "ended"`
- **THEN** the badge and lifecycle bar SHALL render
- **AND** no primary button SHALL render
- **AND** the `⋯` menu SHALL contain only **Detach**

#### Scenario: Overflow menu item does not select the session card
- **WHEN** the user selects **Explore…** from `⋯` on a sidebar session card that is not currently selected
- **THEN** the `ExploreDialog` SHALL open
- **AND** the session card SHALL NOT become selected

#### Scenario: Overflow menu keyboard behavior
- **WHEN** the user focuses the `⋯` button and presses Enter
- **THEN** the menu SHALL open with focus on its first enabled item
- **AND** pressing Escape SHALL close it and return focus to the `⋯` button

#### Scenario: Overflow menu works inside the board session panel
- **WHEN** the session OpenSpec block is opened from a board card's per-session OpenSpec panel and the user opens `⋯` and selects **Detach**
- **THEN** the detach SHALL be sent for that session
- **AND** opening the `⋯` menu SHALL NOT close the enclosing panel or start a card drag

#### Scenario: Unattached session shows no Archive button
- **WHEN** session `"s1"` has `attachedProposal = null` and `status = "active"`
- **THEN** no Archive button SHALL render
#### Scenario: Attached change not in OpenSpec data
- **WHEN** session `"s1"` has `attachedProposal = "gone-change"`, the folder's OpenSpec data does not contain that change, and no archive entry matches (resolution `kind: "missing"`)
- **THEN** the badge SHALL show `gone-change`, then a muted `Not found` badge, then the `⋯` button, whose menu contains only **Detach**
- **AND** no lifecycle bar and no primary action SHALL render

### Requirement: Archived or missing attachment renders a traceable header
When the attachment resolves `kind: "archived"`, the desktop session card, the desktop session header, and the composer session actions SHALL render the following, for running and ended sessions alike:
- the paperclip and the attached name;
- an `Archived <YYYY-MM-DD>` badge, using the entry date;
- archive artifact letters for each artifact in `entry.artifacts`, in that order (as the archive browser renders them). Activating a letter SHALL navigate (push) to `/folder/<encoded resolved cwd>/openspec/archive/<entry.name>/<artifactId>`;
- a `⋯` menu containing only **Detach**.

On mobile, the read-only attached-proposal chips in the header and the card SHALL show the name, the `Archived <YYYY-MM-DD>` badge, and the same archive letters. Detach SHALL remain in the existing `MobileAttachButton` popover. `MobileActionMenu` SHALL NOT offer workflow actions for an archived attachment.

No lifecycle bar, no primary action, and no workflow action (Continue, Fast-forward, Apply, Verify, Archive, Explore) SHALL render for an archived attachment.

When the attachment resolves `kind: "missing"`, those surfaces SHALL render the name, then a muted `Not found` badge titled "Not in active changes or archive (pull may be needed)". Desktop shows `⋯` with only **Detach**; mobile keeps Detach in the popover.

When the attachment resolves `kind: "active"` but the resolved cwd differs from `session.cwd` (a removed worktree whose change is still active in `gitWorktree.mainPath`), the surfaces SHALL render read-only: the name, an `In main checkout` badge, the change's artifact letters linking to the preview route for the resolved cwd, and Detach (desktop `⋯`; mobile popover). No lifecycle bar, no primary action, and no workflow action SHALL render.

When the attachment resolves `kind: "unresolved"`, the surfaces SHALL render the bare attached name with no badge. Desktop shows `⋯` with only **Detach**.

#### Scenario: Ended session attached to an archived change
- **WHEN** ended session `"s1"` has `attachedProposal = "add-auth"` and resolution yields entry `2026-09-30-add-auth` with proposal, design and tasks
- **THEN** the card SHALL show `add-auth`, `Archived 2026-09-30`, letters P, D and T, and `⋯`
- **AND** the `⋯` menu SHALL contain only **Detach**

#### Scenario: Running session after archiving
- **WHEN** running session `"s1"` is attached to `add-auth` and the change has just been archived
- **THEN** the card SHALL switch from the lifecycle UI to the archived header
- **AND** no Apply, Archive or Explore action SHALL render

#### Scenario: Letter opens the archived artifact
- **WHEN** the user activates the D letter on that archived header
- **THEN** the client SHALL navigate (push) to `/folder/<encoded cwd>/openspec/archive/2026-09-30-add-auth/design`
- **AND** the session card SHALL NOT become selected

#### Scenario: Removed worktree session links to the main checkout archive
- **WHEN** the session's cwd is a removed worktree and the archive was found under `gitWorktree.mainPath`
- **THEN** letter links SHALL use the encoded `mainPath`, not `session.cwd`

#### Scenario: Active in main checkout is read-only
- **WHEN** ended session `"s1"` has `cwd = "/repo/.worktrees/os-x"` and resolves `kind: "active"` with `cwd = "/repo"`
- **THEN** the card SHALL show `x`, the `In main checkout` badge, the change's artifact letters and `⋯` with only **Detach**
- **AND** no Apply, Continue or Archive action SHALL render

#### Scenario: Mobile chip stays read-only
- **WHEN** the viewport is mobile and the attachment resolves `archived`
- **THEN** `mobile-header-attached-chip` SHALL show the name, the `Archived` badge and the archive letters
- **AND** the chip SHALL contain no Detach control
- **AND** `MobileAttachButton`'s popover SHALL still offer Detach

#### Scenario: Detach still works on an archived attachment
- **WHEN** the user selects **Detach** on an archived attachment
- **THEN** the browser SHALL send `{ type: "detach_proposal", sessionId: "s1" }`
