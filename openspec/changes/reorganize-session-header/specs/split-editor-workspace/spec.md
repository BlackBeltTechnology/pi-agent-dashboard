## MODIFIED Requirements

### Requirement: Split SHALL be unsplittable and re-splittable

The session header SHALL expose a **layout switch** (`Chat | Split |
Editor`) that owns the layout axis. The switch SHALL be present in every mode
(including `closed`, where no pane header exists), SHALL indicate the current mode,
and SHALL move the content area to any of the three modes in one selection. The
legacy single "Split / Unsplit" toggle and the word "Unsplit" SHALL be
retired. Switching modes SHALL NOT destroy the editor pane's persisted state (open
tabs, tree expansion) or the chat conversation.

On desktop the switch SHALL be a segmented radiogroup at the header's trailing edge, immediately before the View menu. Each segment SHALL be at least 32 px tall and use a 12 px label. When the header container is narrower than 760 px the segments SHALL become icon-only, each with an accessible name and a tooltip.

On mobile the switch SHALL be a single 44 px button that shows the icon of the current mode and opens a menu of three `menuitemradio` items: "Chat", "Split" (described "Chat above, editor below") and "Editor". The current mode SHALL be the checked item. The trigger SHALL carry `data-testid="layout-mode-switch"` and the items SHALL carry `data-testid="layout-mode-closed"`, `layout-mode-split` and `layout-mode-full`.

#### Scenario: Switch reaches any mode in one click
- **GIVEN** the layout switch shows `Split` active
- **WHEN** the user clicks the `Editor` segment
- **THEN** the content area enters `full` mode in a single transition

#### Scenario: Closed reachable directly from full
- **GIVEN** a session in `full` mode
- **WHEN** the user clicks the `Chat` segment
- **THEN** the content area enters `closed` mode
- **AND** the mode value never held `split` between the two states

#### Scenario: Layout switch is keyboard operable and announces the active mode
- **GIVEN** the header layout switch rendered as an exclusive control
- **WHEN** a keyboard user focuses it and presses Arrow keys
- **THEN** on desktop focus moves between the `Chat`/`Split`/`Editor` options and Enter/Space selects one
- **AND** on mobile the arrow keys move between the menu items once the menu is open and Enter/Space selects one
- **AND** the desktop control exposes the current mode as the checked option to assistive tech (`role="radiogroup"`/`radio`, `aria-checked`)
- **AND** the mobile menu exposes the current mode as the checked `menuitemradio`

#### Scenario: Mode change preserves pane state
- **GIVEN** `split` mode with three tabs in the editor pane
- **WHEN** the user switches to `closed` and back to `split`
- **THEN** the editor pane renders with the three tabs and the previously active one

#### Scenario: Switch is present when closed
- **GIVEN** a session in `closed` mode (chat only)
- **WHEN** the header renders
- **THEN** the `Chat | Split | Editor` switch is visible with `Chat` active

#### Scenario: Switch is present on mobile
- **GIVEN** the viewport is below the mobile breakpoint
- **WHEN** the mobile session header renders in any mode
- **THEN** a single 44 px `layout-mode-switch` button is present showing the icon of the current mode
- **AND** activating it opens a menu with the three `menuitemradio` items, the current mode checked
- **AND** the `Split` item is described "Chat above, editor below"
