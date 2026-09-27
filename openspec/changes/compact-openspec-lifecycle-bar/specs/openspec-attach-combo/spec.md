## REMOVED Requirements

### Requirement: Session card displays ChangeState pill next to attached badge
**Reason**: The lifecycle bar's current segment and the single primary action already show the change state. The pill repeated them and took horizontal space on the header row.
**Migration**: None for users. The state stays readable from the bar: the current segment, the check glyph on done segments, and the primary action's label. Tests that assert on the pill move to assertions on segment `data-state` and on the primary action.

### Requirement: OpenSpec workflow stepper inside attached session card
**Reason**: The 7-node pills+lines stepper is replaced by the 5-segment lifecycle bar. Explore is dropped, and Tasks and Apply merge. See `Lifecycle bar inside attached session card`.
**Migration**: The `stepper-node-*` test IDs become `stepper-segment-*`. The `explore` and `apply` nodes have no successor. Their states fold into the Tasks segment and the primary action.

### Requirement: Session card shows attached change badge and actions when attached
**Reason**: The action row with a disabled Explore, a disabled Archive and a standalone Detach is replaced by one primary action plus a `⋯` overflow. See `Attached session header shows one primary action and an overflow menu`.
**Migration**: FF, Verify, Archive anyway and Detach move into the `⋯` menu with the same test IDs. The attached `explore-btn` and disabled `archive-btn` are removed.

### Requirement: Unattached active session shows + Change and Explore buttons
**Reason**: Its attached-session clause requires a disabled inline Explore button, which this change replaces with an enabled, change-scoped **Explore…** item in the `⋯` menu. The unattached behavior is carried over unchanged into `Active session shows + Change and Explore only when unattached`.
**Migration**: The unattached behavior is unchanged. On attached sessions, Explore moves from a disabled inline button into the `⋯` menu, where it is enabled and sends `/skill:openspec-explore <change>`.

## MODIFIED Requirements

### Requirement: PDST rendered as single button navigating to proposal
The chat-view session header (desktop and mobile) SHALL render the attached change's artifact letters as a single combined button (`ArtifactLettersButton`). Each letter keeps its status color. Clicking the button navigates to the proposal artifact. The session card SHALL NOT render this button; there the lifecycle bar carries per-artifact state and navigation.

#### Scenario: Single PDST button in attached session
- **WHEN** session `"s1"` has `attachedProposal = "add-auth"` with artifacts `[proposal: done, design: ready, specs: blocked, tasks: blocked]`
- **THEN** the chat-view session header SHALL show a single clickable button containing `P D S T` with green, yellow, muted, muted colors respectively
- **AND** the session card SHALL NOT show that button

#### Scenario: Clicking PDST button opens proposal
- **WHEN** the user clicks the PDST button for change `"add-auth"`
- **THEN** `onReadArtifact("add-auth", "proposal")` SHALL be called

## ADDED Requirements

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
- **WHEN** session `"s1"` is attached but `status = "ended"`
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
- **WHEN** session `"s1"` has `attachedProposal = "archived-change"` but the folder's OpenSpec data does not contain that change
- **THEN** the badge SHALL show `archived-change` followed by the `⋯` button, whose menu contains only **Detach**
- **AND** no lifecycle bar and no primary action SHALL render
