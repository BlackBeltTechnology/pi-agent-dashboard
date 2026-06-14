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

### Requirement: Unattached active session shows + Change and Explore buttons
When a session is active (not ended) and has no attached proposal, the `SessionOpenSpecActions` component SHALL render a "+ Change" button and an "Explore" button inline next to the attach combo box. The "Explore" button SHALL be enabled (the standard "no proposal → explore freely" affordance).

When a session has an attached proposal, the action row SHALL still render an "Explore" button so the user discovers the affordance, BUT the button SHALL render in a disabled state with a `title` tooltip reading "Detach proposal to explore freely". Clicking a disabled Explore button SHALL be a no-op.

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

#### Scenario: Attached session shows disabled Explore with tooltip
- **WHEN** session `"s1"` has `attachedProposal = "add-auth"`
- **THEN** the action row SHALL render an "Explore" button in a disabled state
- **AND** the button SHALL carry a `title` attribute reading "Detach proposal to explore freely"
- **AND** clicking the button SHALL NOT open the `ExploreDialog`

#### Scenario: Ended session hides + Change and Explore
- **WHEN** session `"s1"` has `status = "ended"` and `attachedProposal = null`
- **THEN** neither "+ Change" nor "Explore" buttons SHALL be rendered

#### Scenario: Attached session does not show + Change
- **WHEN** session `"s1"` has `attachedProposal = "my-change"`
- **THEN** the "+ Change" button SHALL NOT be rendered

### Requirement: PDST rendered as single button navigating to proposal
In both the attached badge line and the folder change list, artifact letters SHALL be rendered as a single combined button (`ArtifactLettersButton`). Each letter keeps its status color. Clicking the button navigates to the proposal artifact.

#### Scenario: Single PDST button in attached session
- **WHEN** session `"s1"` has `attachedProposal = "add-auth"` with artifacts `[proposal: done, design: ready, specs: blocked, tasks: blocked]`
- **THEN** the session card SHALL show a single clickable button containing `P D S T` with green, yellow, muted, muted colors respectively

#### Scenario: Clicking PDST button opens proposal
- **WHEN** the user clicks the PDST button for change `"add-auth"`
- **THEN** `onReadArtifact("add-auth", "proposal")` SHALL be called

### Requirement: Session card displays ChangeState pill next to attached badge
When a session has an `attachedProposal` and the corresponding change is present in the folder's OpenSpec data, the session card SHALL render a small state pill adjacent to the attached-change badge displaying the `ChangeState` value (`PLANNING` / `READY` / `IMPLEMENTING` / `COMPLETE`) with a color-coded text/border scheme — zinc for `PLANNING`, blue for `READY`, amber for `IMPLEMENTING`, green for `COMPLETE`.

#### Scenario: IMPLEMENTING pill for in-progress change
- **WHEN** session `"s1"` has `attachedProposal = "add-auth"` and `deriveChangeState` returns `IMPLEMENTING`
- **THEN** the session card SHALL display a pill reading `IMPLEMENTING` in amber next to the `📋 add-auth` badge

#### Scenario: COMPLETE pill for completed change
- **WHEN** session `"s1"` has `attachedProposal = "add-auth"` and `deriveChangeState` returns `COMPLETE`
- **THEN** the session card SHALL display a pill reading `COMPLETE` in green next to the `📋 add-auth` badge

#### Scenario: Attached change missing from OpenSpec data hides pill
- **WHEN** session `"s1"` has `attachedProposal = "archived-change"` but the folder's OpenSpec data does not contain that change
- **THEN** no state pill SHALL be rendered

### Requirement: OpenSpec workflow stepper inside attached session card
When a session has an `attachedProposal` AND the corresponding `OpenSpecChange` is present in the folder's OpenSpec data, the `SessionOpenSpecActions` component SHALL render a 7-node pills+lines stepper above the action button row. The stepper SHALL visualise the spec-driven workflow with nodes — in left-to-right order — `Explore`, `Proposal`, `Design`, `Specs`, `Tasks`, `Apply`, `Archive`.

Node order MUST match the spec-driven schema where `tasks` is blocked by both `design` and `specs`; therefore `Specs` precedes `Tasks` in the stepper.

Each node SHALL render in one of four states — `done`, `current`, `todo`, `disabled` — derived in a pure function from `(attachedProposal, change.artifacts, change.completedTasks, change.totalTasks, deriveChangeState(change))`:

- `Explore` — `done` when at least one `OpenSpecChange` exists for the cwd OR a proposal is attached. `current` when no proposal is attached AND no changes exist. `disabled` when a proposal is attached (mirrors button gating).
- `Proposal`, `Design`, `Specs` — `done` when `change.artifacts.find(a => a.id === <id>).status === "done"`; `current` when `status === "ready"`; `todo` when `status === "blocked"` or the artifact is absent.
- `Tasks` — `done` when `change.completedTasks === change.totalTasks > 0`; `current` when `0 ≤ change.completedTasks < change.totalTasks` AND `deriveChangeState === IMPLEMENTING`; `todo` otherwise.
- `Apply` — `done` when `deriveChangeState === COMPLETE` AND `change.totalTasks > 0 && change.completedTasks === change.totalTasks`; `current` when `deriveChangeState` is `READY` or `IMPLEMENTING`; `todo` otherwise.
- `Archive` — `current` when `deriveChangeState === COMPLETE`; `todo` otherwise. (Archived changes are not in the active list, so `done` is not reachable from this view.)

Nodes SHALL be connected by short horizontal lines. The connecting line between node N-1 and N SHALL render green (`var(--green)`) when both N-1 and N are `done` or `current`; otherwise grey (`var(--border-secondary)`). The node circle SHALL render with an opaque background base (`var(--bg-tertiary)`) so the connecting line never bleeds through the circle interior.

Done nodes SHALL render with green border + green tint. Their interior glyph depends on whether the node owns an artifact letter (`Proposal`=`P`, `Design`=`D`, `Specs`=`S`, `Tasks`=`T`) and on the active `variant`:

- A done artifact node (one with a letter) SHALL render the **mdi-check** in the `sidebar` variant — where the per-node text label already carries node identity — and SHALL render its **artifact letter** in the `compact` variant, where the label is hidden and the letter is the only surviving identity cue.
- A done non-artifact node (`Explore`, `Apply`, `Archive` — no letter) SHALL render the mdi-check in BOTH variants.

Current nodes SHALL render with orange border + tint and a soft halo pulse (2.4 s ease-in-out infinite, box-shadow goes `3px → 5px → 3px`). Todo nodes SHALL render dim with the artifact letter or icon glyph. Disabled nodes SHALL render at `opacity: 0.4`.

Tasks node SHALL display a `<sub>` line below its label with the text `<completed>/<total>` when `change.totalTasks > 0`.

The stepper component SHALL expose a `variant: "sidebar" | "compact"` prop. `sidebar` is the default (22 px node, 9 px label below each node). `compact` shrinks to 18 px nodes, hides per-node labels (replaced by `title` attribute for tooltip), and scales the row at `transform: scale(.92)` — used by the composer surface and the OpenSpec board cards.

#### Scenario: Sidebar done artifact node renders the check
- **WHEN** the stepper is rendered with `variant="sidebar"` and the `Proposal` node is `done`
- **THEN** the `Proposal` node SHALL render the mdi-check icon
- **AND** its text label `Proposal` SHALL render below the node

#### Scenario: Compact done artifact node renders its letter
- **WHEN** the stepper is rendered with `variant="compact"` and the `Proposal`, `Design`, `Specs` nodes are `done`
- **THEN** each SHALL render its artifact letter (`P`, `D`, `S`) — NOT the mdi-check
- **AND** each SHALL keep its green border + green tint to signal `done`

#### Scenario: Compact done non-artifact node still renders the check
- **WHEN** the stepper is rendered with `variant="compact"` and the `Explore` and `Apply` nodes are `done`
- **THEN** both SHALL render the mdi-check icon (they own no artifact letter)

### Requirement: Session card shows attached change badge and actions when attached
When a session has an `attachedProposal`, the session card SHALL show the attached change name as a badge with `text-blue-400` color, a `ChangeState` pill next to the badge, and LLM action buttons driven by `deriveChangeState`.

The action row SHALL always render an **Archive** button when a proposal is attached. The button SHALL be enabled when `deriveChangeState === COMPLETE`; otherwise rendered disabled with a `title` tooltip reading "Complete tasks first". This makes the archive affordance discoverable for users browsing an IMPLEMENTING change.

When a session has no `attachedProposal`, the action row SHALL still render an **Archive** button in a disabled state with `title` tooltip reading "Attach a change to archive" so the affordance is discoverable. Clicking a disabled Archive button SHALL be a no-op.

Action buttons are disabled when session status is `streaming` and hidden when `ended`. The disabled state from `status === "streaming"` SHALL take precedence over the gating tooltip (tooltip falls back to "Session is streaming").

When `deriveChangeState` returns `IMPLEMENTING` AND the change has `isComplete === true` AND all artifacts are `done`, the action row SHALL additionally expose an **Archive anyway** action in an overflow menu (existing behavior preserved).

#### Scenario: Attached change badge with blue color
- **WHEN** session `"s1"` has `attachedProposal = "add-auth"`
- **THEN** the session card SHALL display `📋 add-auth` with the name in `text-blue-400`

#### Scenario: LLM action buttons for PLANNING state include disabled Archive
- **WHEN** session `"s1"` has `attachedProposal = "add-auth"` and `deriveChangeState` returns `PLANNING`
- **THEN** the session card SHALL show buttons: [Explore (disabled)] [Continue] [FF] [Archive (disabled)] and [Detach]
- **AND** the disabled Archive button SHALL carry `title="Complete tasks first"`

#### Scenario: LLM action buttons for READY state include disabled Archive
- **WHEN** session `"s1"` has `attachedProposal = "add-auth"` and `deriveChangeState` returns `READY`
- **THEN** the session card SHALL show buttons: [Explore (disabled)] [Apply] [Archive (disabled)] and [Detach]

#### Scenario: LLM action buttons for IMPLEMENTING state include disabled Archive
- **WHEN** session `"s1"` has `attachedProposal = "add-auth"` and `deriveChangeState` returns `IMPLEMENTING`
- **THEN** the session card SHALL show buttons: [Explore (disabled)] [Apply] [Tasks N/M] [Archive (disabled)] and [Detach]

#### Scenario: LLM action buttons for COMPLETE state include enabled Archive
- **WHEN** session `"s1"` has `attachedProposal = "add-auth"` and `deriveChangeState` returns `COMPLETE`
- **THEN** the session card SHALL show buttons: [Explore (disabled)] [Verify] [Tasks N/N] [Archive] and [Detach]
- **AND** the Archive button SHALL be enabled (no `title` tooltip beyond the standard label)

#### Scenario: Unattached session shows disabled Archive
- **WHEN** session `"s1"` has `attachedProposal = null` and `status = "active"`
- **THEN** the session card SHALL render a disabled "Archive" button
- **AND** the button SHALL carry `title="Attach a change to archive"`

#### Scenario: Streaming session disables Archive with override tooltip
- **WHEN** session `"s1"` has `attachedProposal = "add-auth"`, `deriveChangeState` returns `COMPLETE`, and `status = "streaming"`
- **THEN** the Archive button SHALL render disabled
- **AND** the button SHALL carry `title="Session is streaming"`

#### Scenario: Archive-anyway overflow action for artifacts-done IMPLEMENTING
- **WHEN** session `"s1"` has `attachedProposal = "add-auth"`, `deriveChangeState` returns `IMPLEMENTING`, `change.isComplete === true`, and every artifact has `status === "done"`
- **THEN** the action row SHALL include an overflow menu (⋯) containing an **Archive anyway** item
- **AND** selecting **Archive anyway** SHALL open a `ConfirmDialog` with message "N of M tasks are unchecked. Archive anyway?"
- **AND** confirming SHALL send `send_prompt` with text `/opsx:archive add-auth` to the session

#### Scenario: Archive-anyway not shown when isComplete is false or undefined
- **WHEN** session `"s1"` is IMPLEMENTING but `change.isComplete !== true` (false or undefined)
- **THEN** no **Archive anyway** action SHALL be offered

#### Scenario: Action buttons disabled when streaming
- **WHEN** session `"s1"` has `attachedProposal = "add-auth"` and `status = "streaming"`
- **THEN** action buttons (Explore, Continue, FF, Apply, Verify, Archive, Archive anyway) SHALL be shown but disabled

#### Scenario: Verify button sends verify command
- **WHEN** the user clicks [Verify] on session `"s1"` with attached change `"add-auth"`
- **THEN** the browser SHALL send `send_prompt` with text `/opsx:verify add-auth` to session `"s1"`

#### Scenario: Action buttons send prompt to session
- **WHEN** the user clicks [Continue] on session `"s1"` with attached change `"add-auth"`
- **THEN** the browser SHALL send `send_prompt` with text `/opsx:continue add-auth` to session `"s1"`

#### Scenario: Detach button clears attachment
- **WHEN** the user clicks [Detach] on session `"s1"`
- **THEN** the browser SHALL send `{ type: "detach_proposal", sessionId: "s1" }`
- **AND** the combo box SHALL reappear

#### Scenario: Ended session hides action buttons
- **WHEN** session `"s1"` has `attachedProposal = "add-auth"` but `status = "ended"`
- **THEN** the badge SHALL still show but LLM action buttons SHALL be hidden

#### Scenario: Attached change not in OpenSpec data
- **WHEN** session `"s1"` has `attachedProposal = "archived-change"` but the folder's OpenSpec data does not contain that change
- **THEN** the badge SHALL still show `📋 archived-change` with a [Detach] button but no LLM action buttons

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
On mobile viewports, the session header SHALL render a paperclip-prefixed chip displaying `session.attachedProposal` whenever that field is non-empty. When the chip is rendered, the mobile session header SHALL use a **two-row layout**:

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
On mobile viewports, each session card SHALL render a paperclip-prefixed chip displaying `session.attachedProposal` whenever that field is non-empty. The chip SHALL coexist with `OpenSpecActivityBadge` (which reads the distinct `openspecPhase` / `openspecChange` fields) — both MAY render simultaneously and MUST NOT visually collide.

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

