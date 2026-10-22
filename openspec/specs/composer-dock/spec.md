# composer-dock Specification

## Purpose
The composer dock is the single surface above the chat composer that shows the bound session's live context (running work, changed files, OpenSpec progress, queued follow-ups, plugin context and the YOLO signal) as collapsible lanes, so the user can see and act on it without leaving the conversation.

## Requirements

### Requirement: Dock renders above the composer card when it has content

When the chat view is bound to a session, the composer is shown, and at least one lane or the YOLO footer has content, a composer dock SHALL render directly above the composer card, as one surface inset from the card's sides and joined to its top edge. Otherwise no dock SHALL render. A read-only (archived) session view shows no composer and therefore no dock.

#### Scenario: Dock appears with content
- **WHEN** the bound session has one background process and nothing else
- **THEN** one dock SHALL render directly above the composer card, containing a Processes lane

#### Scenario: Dock and card read as one connected panel
- **WHEN** the dock renders above the composer card
- **THEN** the dock SHALL be inset from the card's sides, its bottom edge SHALL sit under the card's top edge with no visible gap between them, and no full-width divider line SHALL cross the dock

#### Scenario: Quiet session has no dock
- **WHEN** the bound session's folder has no OpenSpec directory, the session has no `gitWorktree`, and the session has no running work, changed files, queued follow-ups, plugin context or active YOLO
- **THEN** no dock SHALL render

#### Scenario: Worktree session with no other content still shows the Changes lane
- **WHEN** the bound session has `gitWorktree` set and no other dock content
- **THEN** the dock SHALL render with the Changes lane carrying the worktree identity and worktree actions

#### Scenario: Read-only archived view has no dock
- **WHEN** an archived session is opened read-only while YOLO is active
- **THEN** no dock and no YOLO footer SHALL render in its content area

### Requirement: Lanes render only with content, in a fixed order

The dock SHALL render these lanes, each only when it has content, top to bottom: Processes, Changes, OpenSpec, Queue, Context. The Changes lane has content when the session is a worktree session or has changed files. The YOLO footer SHALL be the dock's last line. Each lane SHALL be exposed as `role="group"` with an accessible name equal to its label.

#### Scenario: Lane order
- **WHEN** the bound session has running work, changed files, an attached change, two follow-ups and a `composer-context-group` contribution
- **THEN** the lanes SHALL render in the order Processes, Changes, OpenSpec, Queue, Context

#### Scenario: Empty lane leaves no trace
- **WHEN** the bound session has no queued follow-ups
- **THEN** no Queue lane, label or container SHALL render

### Requirement: Lane disclosure is one target with sibling actions

In the row layout, an expandable lane's header SHALL be one disclosure control spanning the header row, carrying `aria-expanded` and `aria-controls`. The header's actions SHALL be sibling controls, never nested inside the disclosure control. A lane with nothing to expand SHALL render its header as plain content with no disclosure control. Compact mode has its own chip rule.

#### Scenario: Header row toggles the lane
- **WHEN** the user activates any non-action point of a collapsed Processes lane header
- **THEN** the lane SHALL expand and its disclosure control SHALL report `aria-expanded="true"`

#### Scenario: Actions do not toggle
- **WHEN** the user activates the Changes lane's Review action
- **THEN** the review view SHALL open and the lane's expanded state SHALL NOT change

### Requirement: Lanes start collapsed and open one at a time

Every lane SHALL be collapsed whenever the chat view binds to a session, including when it returns to a session viewed before. At most one lane SHALL be expanded at a time: expanding a lane SHALL collapse any other expanded lane. A lane SHALL NOT expand without a user action, including when its content changes.

#### Scenario: Default state
- **WHEN** the chat view binds to a session with five lanes of content
- **THEN** every lane SHALL render collapsed

#### Scenario: Accordion
- **WHEN** the Processes lane is expanded and the user expands the Changes lane
- **THEN** the Changes lane SHALL be expanded and the Processes lane SHALL be collapsed

#### Scenario: New content does not expand a lane
- **WHEN** a new background process appears while every lane is collapsed
- **THEN** every lane SHALL remain collapsed

### Requirement: Lane controls are reachable and never overflow

Every interactive item in a lane SHALL have a target of at least 24×24 CSS px (44×44 at phone width). When a lane header is narrower than its natural width, its descriptive text SHALL truncate with an ellipsis before any action is hidden, and no lane SHALL overflow the dock horizontally.

#### Scenario: Narrow lane header truncates text first
- **WHEN** the Changes lane header is narrower than its natural width
- **THEN** its branch and totals text SHALL truncate with an ellipsis while Review and the worktree actions stay visible
- **AND** no part of the dock SHALL overflow horizontally

### Requirement: Lanes keep the session-action callbacks and slot wiring

The dock's OpenSpec and Changes lanes SHALL use the same `onSendPrompt`, `onReadArtifact`, refresh, `onAttach` and `onDetach` callbacks, and the same slot wiring, as the composer strip they replace.

#### Scenario: Lanes expose group semantics
- **WHEN** the dock renders the OpenSpec and Changes lanes
- **THEN** each SHALL be exposed as `role="group"` with accessible name `OpenSpec` / `Changes`
- **AND** activating their actions SHALL invoke the same callbacks the composer strip invoked

### Requirement: Processes lane lists running work in three groups

The Processes lane SHALL list running work in groups, in this order: groups contributed through `composer-dock-process-group` (such as subagents), the session's unresolved bash tool calls (including nested ones), and its bridge-scanned background processes. Its header SHALL name the total and each non-empty group's count, and the longest elapsed time. When only one group has rows, the header SHALL name that group alone.

#### Scenario: Mixed header
- **WHEN** the session has 3 running subagents, 1 unresolved bash tool call and 2 background processes
- **THEN** the Processes lane header SHALL read `6 running` with `3 subagents · 1 command · 2 background`

#### Scenario: Background only
- **WHEN** the session has 2 background processes and nothing else running
- **THEN** the header SHALL read `2 background processes` and SHALL NOT show group sections in the body

### Requirement: Process rows act on their own kind only

A background-process row SHALL offer Kill, which terminates that process group through the existing PGID kill path (`kill_process`). A command row SHALL offer Show, which scrolls the transcript to that tool call. A subagent row SHALL offer Open, which opens that subagent's detail. No row SHALL abort the turn; the composer's Stop remains the only turn abort.

#### Scenario: Kill targets the process group
- **WHEN** the user activates Kill on the row for process group 60105
- **THEN** the client SHALL send `kill_process` for process group 60105
- **AND** the session's turn SHALL NOT be aborted

#### Scenario: Show scrolls to the tool call
- **WHEN** the user activates Show on a running command row
- **THEN** the transcript SHALL scroll to that command's tool call

#### Scenario: Kill and Stop are worded differently
- **WHEN** a background-process row and the composer's stop affordance are both visible
- **THEN** the row's action SHALL be labelled Kill and the composer's SHALL be labelled Stop

### Requirement: Kill shows progress until the process is gone

After Kill, the row SHALL show `Stopping…` with Kill disabled until a bridge scan no longer lists that process group, then the row SHALL disappear. If two later scans still list it, the row SHALL show `Still running` and re-enable Kill.

#### Scenario: Stopping state after Kill
- **WHEN** the user activates Kill on process group 60105
- **THEN** the row SHALL show `Stopping…` and its Kill control SHALL be disabled until the next scan arrives

#### Scenario: Process gone
- **WHEN** the next scan after Kill no longer lists process group 60105
- **THEN** its row SHALL disappear

#### Scenario: Process survives SIGTERM
- **WHEN** the two scans after the first post-Kill scan still list process group 60105
- **THEN** the row SHALL show `Still running` and Kill SHALL be enabled again

### Requirement: Subagent rows come from plugin contributions

Subagent rows SHALL come only from `composer-dock-process-group` slot contributions; the dock SHALL read no subagent state itself. While a session is bound, the dock SHALL keep each contribution mounted in `"summary"` mode, which renders no DOM, so its count reaches the header and chip. It SHALL mount `"rows"` mode only while the lane body is shown. Background rows keep their existing kinds, including the link from a sub-session process to its session.

#### Scenario: Plugin group renders in the lane
- **WHEN** the subagents plugin contributes a group reporting 3 running subagents
- **THEN** the Processes lane SHALL show that group and count 3 subagents in its header

#### Scenario: Not-yet-started subagent is marked
- **WHEN** a contributed subagent has status `created` (not started yet)
- **THEN** its row SHALL show `pending` instead of an elapsed time

#### Scenario: Sub-session process links to its session
- **WHEN** a background process is classified as a sub-session with a session reference
- **THEN** its row SHALL link to that session, as the session card's process list does

#### Scenario: Plugin-only lane appears while collapsed
- **WHEN** the subagents contribution reports 2 running subagents and the session has no other dock content
- **THEN** the dock SHALL render a collapsed Processes lane whose header names 2 subagents

#### Scenario: Plugin disabled
- **WHEN** no plugin claims `composer-dock-process-group`
- **THEN** the Processes lane SHALL list commands and background processes only, and SHALL render no subagent group

### Requirement: Changes lane shows worktree identity and the session's changed files

The Changes lane header SHALL carry the Git group's worktree identity and worktree actions when the session is a worktree session, then the session's changed-file count with added and removed line totals and a Review action. Expanding it SHALL list each changed file with its origin and line delta; activating a file SHALL open that file's diff.

#### Scenario: Worktree header
- **WHEN** the session has `gitBranch = "os/x"`, `gitWorktree.base = "develop"`, 4 changed files totalling +120 −33, and is 2 commits ahead
- **THEN** the header SHALL show `os/x`, `← develop`, `4 files +120 −33` and `↑2`, followed by Review and the worktree actions

#### Scenario: Main checkout header
- **WHEN** the session is not a worktree session and has 4 changed files
- **THEN** the header SHALL show `4 files changed` with the totals and Review, and no branch

#### Scenario: File opens its diff
- **WHEN** the user activates the row for `packages/client/src/App.tsx`
- **THEN** the diff for `packages/client/src/App.tsx` SHALL open

#### Scenario: Count and totals cover the same files
- **WHEN** the session diff lists 4 in-cwd files with line totals and 1 out-of-cwd entry that is not previewable
- **THEN** the header count and totals SHALL cover the same entries, and the out-of-cwd row SHALL render without a diff link

#### Scenario: Bash-created file is marked
- **WHEN** a changed file's session-diff entry has `detectedVia = "bash-artifact"`
- **THEN** its row SHALL mark it as created via bash

#### Scenario: Deltas are not colour-only
- **WHEN** a row shows +64 −20
- **THEN** both values SHALL carry their sign characters as well as their colour

### Requirement: Changed files come from the session diff and refresh at turn end

The Changes lane's file list and totals SHALL come from the session-diff endpoint, not from client-derived deltas. The client SHALL refetch when the session stops working, when its dirty-file count changes while idle, and when the lane expands. A trigger during an in-flight request, or within 2 s of the last start, SHALL set one pending refetch that runs once the request settles and the window passes.

#### Scenario: Refetch at turn end
- **WHEN** the bound session stops working
- **THEN** the client SHALL refetch the session diff and update the Changes lane totals

#### Scenario: Refetches are coalesced
- **WHEN** the session stops working and its dirty-file count changes within the same second
- **THEN** the client SHALL send one session-diff request, not two

#### Scenario: Trigger during an in-flight request is not lost
- **WHEN** the session stops working while a session-diff request started 3 s ago is still in flight
- **THEN** exactly one further request SHALL run after it settles

#### Scenario: Dirty-count flapping while working
- **WHEN** the dirty-file count changes 10 times in 3 s while the session is working
- **THEN** the client SHALL send no session-diff request until the session stops working

#### Scenario: Unclaimed changes are summarized
- **WHEN** the session diff reports working-tree changes this session cannot claim
- **THEN** the expanded lane SHALL end with one line naming their count with a way to show them

#### Scenario: Partial history does not undercount
- **WHEN** the transcript holds only the latest page of history and the session diff lists 9 changed files
- **THEN** the Changes lane SHALL show 9 files

#### Scenario: No server totals
- **WHEN** the session diff response carries no line totals (non-git folder)
- **THEN** the header SHALL show the file count without `+` and `−` totals

#### Scenario: Unclaimed changes footer
- **WHEN** the session diff reports 3 other working-tree changes
- **THEN** the expanded lane SHALL end with one line naming 3 other changes that are not from this session

### Requirement: Changes lane keeps the last good list when a refetch fails

When a session-diff refetch fails, the Changes lane SHALL keep its last good file list and header totals and SHALL show one inline `Couldn't refresh changes` line with a Retry action, using the inline action-error recipe. Retry SHALL start a refetch under the same coalescing rule. A later successful refetch SHALL remove the line.

#### Scenario: Failed refetch keeps the list
- **WHEN** the Changes lane shows 4 files and the next session-diff request fails with HTTP 500
- **THEN** the 4 files and the header totals SHALL stay, and one `Couldn't refresh changes` line with Retry SHALL render in the lane body

#### Scenario: Retry recovers
- **WHEN** the user activates Retry and the request succeeds with 5 files
- **THEN** the lane SHALL show 5 files and the error line SHALL be gone

### Requirement: Changes lane identity segment for worktree sessions

The Changes lane SHALL carry a worktree identity segment only when `session.gitWorktree` is set: the branch when known; `← <base>` only when `gitWorktree.base` is present; and, when `gitStatus` is present, the dirty count, `↑ahead` / `↓behind` when non-zero, or a no-local-changes marker that never claims remote sync. Without `gitStatus`, no drift or no-changes marker SHALL render. Every marker SHALL have a text alternative.

#### Scenario: Git identity shows branch, base and drift
- **WHEN** the bound session has `gitBranch = "os/x"`, `gitWorktree = { name: "os-x", mainPath: "/repo", base: "develop" }` and `gitStatus = { dirtyCount: 3, ahead: 2, behind: 0, … }`
- **THEN** the Changes lane's identity segment SHALL show `os/x`, `← develop`, a dirty count of `3` and `↑2`
- **AND** it SHALL NOT show a behind count

#### Scenario: Base omitted when unknown
- **WHEN** `gitWorktree.base` is absent
- **THEN** the identity segment SHALL NOT render a `←` base marker

#### Scenario: Unknown status is not shown as clean
- **WHEN** `gitStatus` is absent
- **THEN** the identity segment SHALL render neither a no-changes marker nor drift markers

#### Scenario: Identity tooltip names the worktree
- **WHEN** the user hovers the identity segment of worktree `os-x` whose main checkout is `/repo`
- **THEN** its tooltip SHALL name `os-x` and `/repo`

### Requirement: OpenSpec lane renders by readiness

The OpenSpec lane SHALL render when the folder's OpenSpec readiness is ready or pending (else `hasOpenspecDir !== false || pending`) and the session has not ended, and also for the traceable attachments below. Unattached, it SHALL hold `Attach change…` (disabled, labelled `No changes`, when the folder has none), `Explore`, and a `⋯` with the card's unattached workflow entries plus Refresh, and no lifecycle bar, primary or `Archive`.

#### Scenario: Unattached session shows Explore
- **WHEN** the bound session has `attachedProposal = null` and the folder has changes
- **THEN** the OpenSpec lane SHALL contain an enabled `Attach change…` control and an enabled `Explore` button
- **AND** it SHALL NOT contain a lifecycle bar or an `Archive` button
- **AND** it SHALL NOT be expandable

#### Scenario: Attach from the lane
- **WHEN** the user activates `Attach change…` and picks change `"add-auth"`
- **THEN** the lane SHALL invoke `onAttach` with `"add-auth"`

#### Scenario: No changes to attach
- **WHEN** the bound session is unattached and the folder has no OpenSpec changes
- **THEN** the attach control SHALL render disabled with the label `No changes`

### Requirement: Untraceable attachments keep a traceable OpenSpec lane

When the attachment resolves archived, missing or in the main checkout, the OpenSpec lane SHALL render, for running and ended sessions alike, what `openspec-attach-combo` ("Archived or missing attachment renders a traceable header") requires of the composer session actions, with no lifecycle bar, primary or workflow action.

#### Scenario: Archived attachment on an ended session
- **WHEN** ended session `"s1"` is attached to change `"add-auth"`, which resolves archived on 2026-10-01
- **THEN** the OpenSpec lane SHALL render `add-auth`, an `Archived 2026-10-01` badge, the archive artifact letters and a `⋯` containing only Detach

### Requirement: Attached OpenSpec lane carries the change, one primary and its next tasks

Attached, the lane title SHALL be the change name with its `done/total` task count, followed by the session card's lifecycle bar in letter form (the Tasks segment shows its letter), at most one primary chosen by the session card's per-`ChangeState` order and workflow gating, and `⋯`. `⋯` SHALL list the card's remaining items (including `Explore…`) plus Open proposal, Refresh and Detach. Expanding SHALL show the next open tasks read from `tasks.md`.

#### Scenario: Session actions relocate into the dock with unchanged gating
- **WHEN** the chat view is bound to session `"s1"` with `attachedProposal = "add-auth"`, `deriveChangeState` returns `IMPLEMENTING` with `12/39` tasks, and `apply` is enabled
- **THEN** the OpenSpec lane SHALL contain the title `add-auth` with `12/39 tasks`, a lifecycle bar, an `Apply` primary and a `⋯` control
- **AND** it SHALL NOT contain a standalone `Explore` button (Explore is reachable from `⋯`)

#### Scenario: Firing Apply from the lane dispatches the skill prompt
- **WHEN** the user clicks `Apply` in the OpenSpec lane for session `"s1"` with attached change `"add-auth"`
- **THEN** the lane SHALL invoke `onSendPrompt` with `/skill:openspec-apply-change add-auth`

#### Scenario: Complete change shows Archive
- **WHEN** the bound session is attached, `deriveChangeState` returns `COMPLETE`, `archive` is enabled, and Merge does not qualify as the filled primary
- **THEN** the OpenSpec lane's filled primary action SHALL be `Archive`

#### Scenario: Overflow offers detach
- **WHEN** the user opens `⋯` on the OpenSpec lane for attached change `"add-auth"` and activates `Detach`
- **THEN** the lane SHALL invoke `onDetach`

#### Scenario: Tasks read on expand
- **WHEN** the user expands the attached OpenSpec lane
- **THEN** the client SHALL fetch the change's tasks (parsed from its `tasks.md`) and list its next open tasks with their numbers, marking done tasks with a shape as well as colour

### Requirement: OpenSpec task list shows a recoverable error

When fetching the attached change's tasks fails on expand, the OpenSpec lane body SHALL show one inline `Couldn't load tasks` line with Retry and the `Open tasks.md` link. The lane header (title, count, lifecycle bar, primary and `⋯`) SHALL be unchanged.

#### Scenario: Tasks fetch fails
- **WHEN** the user expands the attached OpenSpec lane and the tasks request returns HTTP 404
- **THEN** the lane body SHALL show `Couldn't load tasks` with Retry and `Open tasks.md`, and the header SHALL still show the primary action

### Requirement: OpenSpec lane actions follow the working state

A session is working when its status is `streaming` or it is auto-retrying a provider error. While working, the lane's primary action, its `⋯` workflow items and `Explore` SHALL be disabled, focusable and expose the reason, and the Tasks segment SHALL be inert. The Proposal, Design and Specs segments, `Open proposal`, `Attach change…`, `Detach` and `Refresh` SHALL stay enabled. Every action SHALL stay subject to the folder's workflow configuration.

#### Scenario: Streaming disables lane actions except refresh
- **WHEN** the bound session is attached and is working
- **THEN** the primary action and every `⋯` workflow item SHALL be disabled, and the Tasks segment SHALL be inert
- **AND** the Proposal/Design/Specs segments, `Open proposal`, `Attach change…`, `Detach` and `Refresh` SHALL remain enabled
- **AND** each disabled item, including those inside `⋯`, SHALL remain focusable and expose why it is disabled

#### Scenario: Auto-retry counts as working
- **WHEN** the bound session's status is `idle` but it is auto-retrying a provider error
- **THEN** the OpenSpec primary action SHALL be disabled
- **AND** it SHALL remain focusable and expose why it is disabled

#### Scenario: Session card honours auto-retry too
- **WHEN** a session is auto-retrying a provider error and its session card is visible
- **THEN** the card's OpenSpec primary action and its worktree Push / Merge actions SHALL be disabled

### Requirement: Dock and session card choose the same OpenSpec actions

For the same attached session, the dock's OpenSpec lane and the session card SHALL derive the same primary action and SHALL offer the same set of workflow items, though placement may differ. The dock's `⋯` SHALL additionally offer `Open proposal` and `Refresh`.

#### Scenario: Composer and session card choose the same primary
- **WHEN** the same attached session is shown in the dock and on its session card, for any `ChangeState` and workflow configuration
- **THEN** both SHALL derive the same OpenSpec primary action. On the desktop session card it is the actions menu's NEXT item, or a plain OPENSPEC item when Merge is NEXT.
- **AND** the dock's `⋯` and the desktop session card's actions menu SHALL offer the same set of workflow items (the menu shows Verify outside `More…`)

### Requirement: At most one filled primary in the dock

At most one control in the whole dock SHALL render as a filled primary. When the worktree Merge qualifies as the filled primary (see `worktree-lifecycle`), the OpenSpec primary SHALL render outlined and enabled; otherwise the OpenSpec primary is the filled one.

#### Scenario: Green PR on a complete change takes the single primary
- **WHEN** the attached change is `COMPLETE`, the PR is open, not a draft, with `gitPrChecks = "passing"`, and every other Merge-emphasis condition of `worktree-lifecycle` holds
- **THEN** Merge SHALL render as the dock's only filled primary
- **AND** the OpenSpec primary SHALL render outlined and enabled

### Requirement: Queue lane hosts the follow-up cycler

The Queue lane SHALL render when the session has queued follow-ups. Its header SHALL name the count and that they are delivered when the agent finishes the turn, with Clear all when there are two or more. Expanding it SHALL render the existing follow-up cycler (navigation, position, edit, move-to-front, remove, height cap, attachment indicator) unchanged. Steering stays inline in the transcript.

#### Scenario: Queue header
- **WHEN** the session has 2 queued follow-ups
- **THEN** the Queue lane header SHALL read `2 queued follow-ups` and offer Clear all

#### Scenario: Clear all empties the buffer
- **WHEN** the user activates the Queue lane's Clear all while bound to session S
- **THEN** the client SHALL send `clear_followup_entries { sessionId: "S", indices: "all" }`

#### Scenario: Cycler behaviour is unchanged inside the lane
- **WHEN** the expanded Queue lane shows a follow-up with 2 attached images
- **THEN** `queue-chip-followup` and `queue-followup-attachments` SHALL render as in `mid-turn-prompt-queue`, with the count 2

### Requirement: Context lane hosts plugin context groups

The Context lane SHALL render when a `composer-context-group` or `session-card-badge` claim applies to the session, showing contributions then the Status group. A group that renders nothing SHALL leave no container or label, and a lane whose groups all render nothing SHALL leave no visible trace. It SHALL NOT be expandable. `composer-context-group` contributions SHALL NOT be disabled or dimmed while the session is working; the Status group SHALL keep its working-state disable.

#### Scenario: Quota stays live while working
- **WHEN** a plugin contributes a Quota group and the session is streaming
- **THEN** the Context lane SHALL show the Quota group at full opacity with its controls enabled
- **AND** it SHALL stay interactive while the OpenSpec and Changes lane actions are disabled

#### Scenario: Status group keeps its working gate
- **WHEN** the session is streaming and a `session-card-badge` claim renders a control
- **THEN** that control SHALL be disabled, while `composer-context-group` controls stay enabled

#### Scenario: Empty Status group leaves no label
- **WHEN** a `session-card-badge` claim exists but its component renders nothing for the bound session
- **THEN** no visible `STATUS` label or group container SHALL render

### Requirement: YOLO footer stays visible in the dock

When YOLO is active for the composer's working directory, the YOLO signal SHALL render as the dock's last line, directly above the composer card. It SHALL NOT be collapsible, SHALL NOT fold into a summary chip, and SHALL NOT scroll with the lanes. Every composer-strip clause of `access-grant-yolo` SHALL apply to it unchanged.

#### Scenario: Footer outside the scrolling lanes
- **WHEN** an expanded lane's content exceeds the dock's height
- **THEN** the lanes SHALL scroll and the YOLO footer SHALL remain fully visible

#### Scenario: Footer in compact mode
- **WHEN** the dock is in compact mode
- **THEN** the YOLO footer SHALL render as a full-width line below the summary chips, not as a chip

#### Scenario: Footer stays one line in a short pane
- **WHEN** the interface language is `hu`, the viewport is 375 px wide, and the pane is short enough that the dock's lanes scroll
- **THEN** the YOLO footer's height SHALL equal one line box plus its padding and border, and its remaining time SHALL stay fully visible

#### Scenario: Footer meets the YOLO verified set inside the dock
- **WHEN** the footer renders at 375, 768 and 1500 px viewports in `en` and `hu`, scoped and unscoped
- **THEN** it SHALL stay on one line within the composer column, keep its link text equal to the full description, keep the remaining time outside the link's name, and degrade the description first

#### Scenario: YOLO only
- **WHEN** YOLO is active and no lane has content
- **THEN** the dock SHALL render with the YOLO footer as its only line

#### Scenario: No live region around the footer
- **WHEN** the dock renders the YOLO footer
- **THEN** neither the footer nor any of its ancestors SHALL carry a live-region role or an `aria-live` value other than `off`

### Requirement: Compact dock below 520 px

When the composer column is narrower than 32.5rem (520 px at the default 16 px root), every lane SHALL render as one summary chip in a single row. Each chip is a disclosure control naming the lane and its count, also for lanes that are not expandable in rows. It SHALL open a sheet below the chips holding that lane's header actions and body, one lane at a time. The YOLO footer is not a chip. The threshold follows the container width.

#### Scenario: Narrow split pane on a wide viewport
- **WHEN** the chat pane is 480 px wide inside a 1500 px viewport at the default root size
- **THEN** the dock SHALL render summary chips instead of lane rows

#### Scenario: Chip opens its lane
- **WHEN** the user activates the Changes chip in compact mode
- **THEN** the Changes lane's actions and file list SHALL render below the chips and the chip SHALL report `aria-expanded="true"`

#### Scenario: Layout flip keeps the open lane and focus
- **WHEN** the Changes lane is open and the dock container shrinks from 521 px to 519 px
- **THEN** the Changes chip SHALL be expanded with its sheet shown, and focus SHALL move to the Changes chip if it was inside the lane

#### Scenario: Phone targets
- **WHEN** the dock renders at a 375 px viewport
- **THEN** every chip, row action and lane control SHALL be at least 44×44 CSS px

### Requirement: Dock announces counts, never ticking times

The dock SHALL announce changes in its lanes' counts through one polite live region that is a sibling of the lanes. Elapsed times and other text that changes on a clock SHALL NOT be inside any live region.

#### Scenario: Count change announced
- **WHEN** a third background process starts
- **THEN** the dock's live region SHALL announce the new background count once

#### Scenario: Elapsed tick is silent
- **WHEN** a row's elapsed time advances from 59s to 1m 0s
- **THEN** no live region SHALL change its content

### Requirement: Dock is a shrinkable row of the chat pane

The dock SHALL be a shrinkable row of the chat pane's height budget, declared in the row table. Under a deficit its lanes SHALL give height by scrolling, down to a bound equal to the YOLO footer's fixed one-line height (0 without YOLO). The declared floor SHALL exceed the bound with or without lanes, so the footer is never clipped.

#### Scenario: Footer-only dock keeps floor above bound
- **WHEN** YOLO is active and no lane has content
- **THEN** the row's declared bound SHALL equal the footer height and its floor SHALL be greater than the bound

#### Scenario: Short pane
- **WHEN** the pane is too short to fit the transcript floor, the dock and the composer at their content heights
- **THEN** the dock's lanes SHALL scroll internally and the YOLO footer and composer card SHALL remain fully visible

### Requirement: Dock replaces the composer strip in other capabilities

Where another capability names the composer strip's OpenSpec group, its Git group, or the session-actions strip, those SHALL mean the dock's OpenSpec lane, Changes lane and dock. The context strip or queue panel as parts of the composer stack SHALL mean the dock, and the status row SHALL mean the toolbar's working-status word. The `access-grant-yolo` composer strip SHALL mean the YOLO footer.

#### Scenario: Worktree actions location
- **WHEN** a worktree session is bound
- **THEN** the worktree actions that `worktree-lifecycle` places in the composer strip's Git group SHALL render in the Changes lane header

#### Scenario: Canvas chip tray anchor
- **WHEN** the canvas chip tray anchors above the live composer stack
- **THEN** it SHALL track the top edge of the dock, or of the composer card when no dock renders

### Requirement: Folder home composer renders the dock

The folder home composer SHALL render the dock above its card with the YOLO footer only (it has no bound session, so no lanes), so the YOLO signal appears in the same place as on a session.

#### Scenario: YOLO on folder home
- **WHEN** YOLO is active for a folder and the operator opens that folder's home
- **THEN** the YOLO footer SHALL render in a dock directly above the folder home composer card
