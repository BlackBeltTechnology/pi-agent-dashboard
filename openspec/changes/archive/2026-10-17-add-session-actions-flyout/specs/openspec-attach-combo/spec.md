## MODIFIED Requirements

### Requirement: Session card shows attach combo box when no proposal attached
On the desktop session card, attaching is offered as the **Attach change…** item of the session actions menu's OPENSPEC group. That item opens the searchable attach dialog directly, and the card renders no inline `<select>`. Every other surface that mounts the session OpenSpec block (for example, the per-session panel on board cards) SHALL display a `<select>` dropdown listing available changes from the folder-level OpenSpec data when the session has no attached proposal and the directory has initialized OpenSpec data. **When the user opens the searchable attach dialog (the dialog reachable from the combo box's "Browse all changes…" entry or equivalent affordance), the dialog SHALL render group sections + pill row when the cwd has at least one defined group; otherwise the dialog renders the flat list exactly as today.** The inline `<select>` combo box itself remains a flat list — group structure is exposed only inside the searchable dialog.

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

#### Scenario: Desktop session card attaches through the menu
- **WHEN** a desktop session card renders for session `"s1"` with `attachedProposal = null` in an OpenSpec-initialised folder
- **THEN** no inline attach `<select>` SHALL render on the card
- **AND** the session actions menu's OPENSPEC group SHALL contain **Attach change…**, which opens the searchable attach dialog
- **AND** selecting `"add-auth"` there SHALL send `{ type: "attach_proposal", sessionId: "s1", changeName: "add-auth" }`

### Requirement: Bulk Archive button on session card when completed changes exist
The `SessionOpenSpecActions` component SHALL render a "Bulk Archive" button **only on unattached sessions** when at least one change in the folder has `status === "complete"`. On the desktop session card, the same action is offered as the **Bulk archive…** item of the session actions menu's OPENSPEC group, under the same conditions, with the same confirmation and the same streaming-disabled rule; no inline button renders on that card. Attached-session action rows SHALL NOT render a Bulk Archive button.

#### Scenario: Bulk Archive shown on unattached session when completed changes exist
- **WHEN** session `"s1"` has no attached proposal, is in cwd `/project/foo`, and the folder has changes `["done-change" (complete), "wip-change" (in-progress)]`
- **THEN** a surface that mounts the session OpenSpec block inline (for example, the board panel) SHALL show a "Bulk Archive" button alongside the attach combo box

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
- **THEN** the Bulk Archive control (the inline button, or the **Bulk archive…** menu item on the desktop session card) SHALL be shown but disabled

#### Scenario: Desktop session card offers Bulk archive in the menu
- **WHEN** unattached session `"s1"` in cwd `/project/foo` renders as a desktop session card, and the folder contains a completed change
- **THEN** no inline "Bulk Archive" button SHALL render on the card
- **AND** the session actions menu's OPENSPEC group SHALL contain **Bulk archive…**, whose confirmation sends `{ type: "openspec_bulk_archive", cwd: "/project/foo" }`

### Requirement: Active session shows + Change and Explore only when unattached
When a session is active (not ended) and has no attached proposal, the `SessionOpenSpecActions` component SHALL render a "+ Change" button and an enabled "Explore" button inline next to the attach combo box, each subject to the folder's workflow configuration. When a session has an attached proposal, neither "+ Change" nor an inline "Explore" button SHALL render. Change-scoped Explore is offered in the `⋯` menu instead (see `Attached session header shows one primary action and an overflow menu`).

On the desktop session card, these actions are offered as the **New change…** and **Explore…** items, together with **Propose…** from the same shared derivation, in the session actions menu's OPENSPEC group, under the same conditions. No inline buttons render on that card.

#### Scenario: Active session with no attachment shows enabled Explore
- **WHEN** session `"s1"` has `status = "active"` and `attachedProposal = null`
- **THEN** a surface that mounts the session OpenSpec block inline SHALL show the attach combo box, a "+ Change" button, and an enabled "Explore" button in a single row

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

#### Scenario: Desktop session card offers New change and Explore in the menu
- **WHEN** active, unattached session `"s1"` renders as a desktop session card
- **THEN** no inline "+ Change" or "Explore" button SHALL render on the card
- **AND** the session actions menu's OPENSPEC group SHALL contain **New change…** (opens `NewChangeDialog`) and **Explore…** (opens `ExploreDialog` with an empty change name)

### Requirement: Attached session header shows one primary action and an overflow menu
When a session has an `attachedProposal`, the session OpenSpec block SHALL show one header row:
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

**Desktop session card.** The desktop session card SHALL NOT mount the header's primary button or its `⋯` button. It shows the attached change link and the lifecycle bar. The same derivation SHALL feed the session actions menu:
- the primary action becomes that menu's NEXT item, unless the Merge-emphasis rule makes Merge the NEXT item instead;
- the `⋯` items become OPENSPEC items, with Fast-forward, Explore…, Archive anyway… and Detach folded behind `More…`;
- Verify renders as a visible OPENSPEC item whenever it is not the NEXT item.

The workflow gating, the streaming rule and the ended rule above SHALL apply to those menu items exactly as they apply to the header. On the menu they are expressed as `aria-disabled` items or absent items.

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

#### Scenario: Desktop session card shows no primary or overflow button
- **WHEN** session `"s1"` attached to `"add-auth"` in state `IMPLEMENTING` renders as a desktop session card
- **THEN** no Apply button and no OpenSpec `⋯` button SHALL render on the card
- **AND** the card SHALL render the attached change link and the lifecycle bar
- **AND** the session actions menu SHALL show **Apply** as its NEXT item and list **Explore…** and **Detach** under the OPENSPEC `More…`

#### Scenario: Ended desktop card keeps Detach reachable
- **WHEN** ended session `"s1"` attached to `"add-auth"` renders as a desktop session card
- **THEN** the session actions menu SHALL contain no NEXT item
- **AND** **Detach** SHALL remain reachable in its OPENSPEC group

### Requirement: Archived or missing attachment renders a traceable header
When the attachment resolves `kind: "archived"`, the desktop session card, the desktop session header, and the composer session actions SHALL render the following, for running and ended sessions alike:
- the paperclip and the attached name;
- an `Archived <YYYY-MM-DD>` badge, using the entry date;
- archive artifact letters for each artifact in `entry.artifacts`, in that order (as the archive browser renders them). Activating a letter SHALL navigate (push) to `/folder/<encoded resolved cwd>/openspec/archive/<entry.name>/<artifactId>`;
- a `⋯` menu containing only **Detach**. On the desktop session card, this `⋯` SHALL NOT render. Detach, and an item per archive letter with the same navigation, are offered in the session actions menu's OPENSPEC group instead. The badge and the letters stay on the card.

On mobile, the read-only attached-proposal chips in the header and the card SHALL show the name, the `Archived <YYYY-MM-DD>` badge, and the same archive letters. Detach SHALL remain in the existing `MobileAttachButton` popover. `MobileActionMenu` SHALL NOT offer workflow actions for an archived attachment.

No lifecycle bar, no primary action, and no workflow action (Continue, Fast-forward, Apply, Verify, Archive, Explore) SHALL render for an archived attachment.

When the attachment resolves `kind: "missing"`, those surfaces SHALL render the name, then a muted `Not found` badge titled "Not in active changes or archive (pull may be needed)". Desktop shows `⋯` with only **Detach** (on the desktop session card: Detach in the session actions menu); mobile keeps Detach in the popover.

When the attachment resolves `kind: "active"` but the resolved cwd differs from `session.cwd` (a removed worktree whose change is still active in `gitWorktree.mainPath`), the surfaces SHALL render read-only: the name, an `In main checkout` badge, the change's artifact letters linking to the preview route for the resolved cwd, and Detach (desktop `⋯`, or the session actions menu on the desktop session card; mobile popover). No lifecycle bar, no primary action, and no workflow action SHALL render.

When the attachment resolves `kind: "unresolved"`, the surfaces SHALL render the bare attached name with no badge. Desktop shows `⋯` with only **Detach** (on the desktop session card: Detach in the session actions menu).

#### Scenario: Ended session attached to an archived change
- **WHEN** ended session `"s1"` has `attachedProposal = "add-auth"` and resolution yields entry `2026-09-30-add-auth` with proposal, design and tasks
- **THEN** the desktop session card SHALL show `add-auth`, `Archived 2026-09-30`, and letters P, D and T, with no OpenSpec `⋯`
- **AND** the session actions menu's OPENSPEC group SHALL contain items P, D and T and **Detach**, and no workflow item

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
- **THEN** the card SHALL show `x`, the `In main checkout` badge and the change's artifact letters
- **AND** the session actions menu's OPENSPEC group SHALL offer only those letters and **Detach**
- **AND** no Apply, Continue or Archive action SHALL render

#### Scenario: Mobile chip stays read-only
- **WHEN** the viewport is mobile and the attachment resolves `archived`
- **THEN** `mobile-header-attached-chip` SHALL show the name, the `Archived` badge and the archive letters
- **AND** the chip SHALL contain no Detach control
- **AND** `MobileAttachButton`'s popover SHALL still offer Detach

#### Scenario: Detach still works on an archived attachment
- **WHEN** the user selects **Detach** on an archived attachment
- **THEN** the browser SHALL send `{ type: "detach_proposal", sessionId: "s1" }`
