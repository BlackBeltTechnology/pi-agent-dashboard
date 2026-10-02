## MODIFIED Requirements

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

## ADDED Requirements

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
