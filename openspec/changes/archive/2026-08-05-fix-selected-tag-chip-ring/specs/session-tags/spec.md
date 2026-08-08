## ADDED Requirements

### Requirement: Selected filter chip indicates selection in its own tag color

A user-tone filter chip in the selected state SHALL render a selection indicator that is
visually distinguishable from the unselected state. The indicator's color SHALL be derived
from that chip's own tag color (the deterministic `tagColor(label)` palette entry), NOT
from the ambient inherited text color of the surrounding sidebar. This SHALL hold in both
user-tone filter chip layouts: the plain toggle-only chip, and the chip that additionally
renders the destructive global-delete ✕ control. In BOTH layouts the indicator SHALL be
hosted on the toggle itself, so it fits the chip. The indicator SHALL NOT be the sole signal
of selection — `aria-pressed` remains the programmatic selected-state signal.

#### Scenario: Selection indicator color tracks the tag color

- **WHEN** a user-tone filter chip for tag `dashboard` is rendered in the selected state
- **THEN** its selection indicator color SHALL equal the `tagColor("dashboard")` palette
  color
- **AND** it SHALL NOT resolve to the inherited ambient text color of the sidebar

#### Scenario: Remove-enabled selected chip is indicated on the toggle, not the wrapper

- **WHEN** a user-tone filter chip is selected AND a global-delete ✕ control is enabled for
  it
- **THEN** the selection indicator SHALL be hosted on the toggle, fitting the chip
- **AND** the enclosing wrapper SHALL render NO indicator of its own
- **AND** the ✕ SHALL fall OUTSIDE the indicator, because it is a destructive action rather
  than part of the selection state
- **AND** the indicator color SHALL still be derived from that chip's tag color
- **AND** the toggle and the ✕ SHALL remain on one line as a single unit

#### Scenario: The indicator fits the chip rather than enclosing the ✕

- **GIVEN** hosting the indicator on the wrapper measured 67.9×24 CSS px around a 41.9×19.8
  chip — +28 px wide and +6.2 px tall, because the wrapper also spans the ✕'s ≥24 px hit area
- **WHEN** a remove-enabled user-tone filter chip is selected
- **THEN** the indicator's box SHALL track the toggle's box, not the wrapper's

#### Scenario: Unselected chip renders no selection indicator

- **WHEN** a user-tone filter chip is rendered in the unselected state
- **THEN** no selection indicator SHALL be rendered
- **AND** `aria-pressed` SHALL be `false`

#### Scenario: Selection behavior is unchanged

- **WHEN** the user activates a selected or unselected user-tone filter chip
- **THEN** the chip's toggle handler SHALL fire exactly as before
- **AND** the tag filter axis composition, the global-delete ✕ behavior, and tag
  persistence SHALL be unaffected
