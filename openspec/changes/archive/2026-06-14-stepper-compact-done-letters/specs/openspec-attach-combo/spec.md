## MODIFIED Requirements

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
