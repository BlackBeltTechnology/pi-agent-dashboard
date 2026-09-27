## MODIFIED Requirements

### Requirement: Proposal cards
Each change SHALL render as a card showing its name, the compact lifecycle bar, its session list, and card actions. The card SHALL NOT render a separate state pill or a separate task-progress bar; the lifecycle bar carries both.

#### Scenario: Card content
- **WHEN** a change `add-auth` is `IMPLEMENTING` with `3/8` tasks
- **THEN** its card SHALL show the name, the lifecycle bar with the `Tasks` segment labelled `3/8`, its sessions, and `New session` / `New worktree` actions
- **AND** no state pill and no standalone progress bar SHALL render on the card

### Requirement: Lifecycle stepper on cards
Each card SHALL render the OpenSpec lifecycle bar (`Proposal → Design → Specs → Tasks → Archive`) in its `compact` variant. Segment states, glyphs, fill, status-primitive tokens and accessible names SHALL be identical to the session-card lifecycle bar. The compact variant SHALL render no primary action and no `⋯` overflow menu.

Clicking `Proposal`, `Design`, or `Specs` SHALL open the artifact. Clicking `Tasks` SHALL open the tasks list when `totalTasks > 0`. The `Archive` segment SHALL be inert on the board. Segment clicks and pointer-downs SHALL NOT start a card drag.

When the bar's width is below 250 CSS px, labels SHALL collapse to letters (`P`, `D`, `S`, `A`) while `Tasks` keeps `<completed>/<total>`.

#### Scenario: Stepper reflects state
- **WHEN** a change has proposal/design/specs done and is implementing with `6/14` tasks
- **THEN** `Proposal`/`Design`/`Specs` SHALL render done with a check glyph, `Tasks` SHALL render current with label `6/14` and a proportional fill, and `Archive` SHALL render todo
- **AND** no `Explore` or `Apply` segment SHALL render

#### Scenario: Segment press does not start a drag
- **WHEN** the user presses and releases on the `Design` segment of a card
- **THEN** the artifact SHALL open
- **AND** no card drag SHALL start
