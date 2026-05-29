## ADDED Requirements

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

Done nodes SHALL render with green border + tint and an mdi-check icon (or the artifact letter `P`/`D`/`S`/`T` for artifact nodes). Current nodes SHALL render with orange border + tint and a soft halo pulse (2.4 s ease-in-out infinite, box-shadow goes `3px → 5px → 3px`). Todo nodes SHALL render dim with the artifact letter or icon glyph. Disabled nodes SHALL render at `opacity: 0.4`.

Tasks node SHALL display a `<sub>` line below its label with the text `<completed>/<total>` when `change.totalTasks > 0`.

The stepper component SHALL expose a `variant: "sidebar" | "compact"` prop. `sidebar` is the default (22 px node, 9 px label below each node). `compact` shrinks to 18 px nodes, hides per-node labels (replaced by `title` attribute for tooltip), and scales the row at `transform: scale(.92)` — used by the composer surface.

#### Scenario: Implementing change shows Specs done and Tasks current
- **WHEN** session `"s1"` has `attachedProposal = "add-auth"`, `deriveChangeState` returns `IMPLEMENTING`, `change.artifacts` has `proposal/design/specs` all `done`, `change.completedTasks = 4`, `change.totalTasks = 12`
- **THEN** the stepper SHALL render with `Explore`, `Proposal`, `Design`, `Specs` all `done`
- **AND** `Tasks` SHALL render `current` with sub-label `4/12`
- **AND** `Apply` SHALL render `current`
- **AND** `Archive` SHALL render `todo`

#### Scenario: Complete change with all tasks done
- **WHEN** session `"s1"` has `attachedProposal = "add-auth"`, `deriveChangeState` returns `COMPLETE`, every artifact `done`, `change.completedTasks === change.totalTasks > 0`
- **THEN** the first six nodes (`Explore`, `Proposal`, `Design`, `Specs`, `Tasks`, `Apply`) SHALL all render `done`
- **AND** `Archive` SHALL render `current`

#### Scenario: No proposal attached, no changes in cwd
- **WHEN** session `"s1"` has `attachedProposal = null` AND the folder's `openspecChanges` is `[]`
- **THEN** the stepper SHALL render with `Explore` as `current`
- **AND** every other node SHALL render `todo`
- **AND** `Archive` SHALL render `disabled`

#### Scenario: Tasks node sub-label hidden when totalTasks is zero
- **WHEN** the stepper is rendered for a change with `change.totalTasks === 0`
- **THEN** the `Tasks` node SHALL NOT render the `<sub>` line

#### Scenario: Connecting line never visible inside a node interior
- **WHEN** the stepper is rendered with consecutive `done` nodes
- **THEN** the green connecting line SHALL terminate at the outer edge of each circle
- **AND** the circle's filled background SHALL fully obscure the line behind it

#### Scenario: Compact variant in composer
- **WHEN** the stepper is rendered with `variant="compact"`
- **THEN** the node circles SHALL render at 18 px diameter
- **AND** the per-node text label SHALL NOT render under each node
- **AND** each node SHALL carry a `title` attribute equal to the label text it would otherwise show

#### Scenario: Reduced-motion suppresses current-node halo pulse
- **WHEN** `prefers-reduced-motion: reduce` is active
- **AND** the stepper is rendered with a `current` node
- **THEN** the current node's box-shadow SHALL remain static at 3 px without animation

## MODIFIED Requirements

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
