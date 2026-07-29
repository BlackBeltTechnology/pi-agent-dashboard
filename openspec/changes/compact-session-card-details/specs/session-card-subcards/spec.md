# session-card-subcards — delta

## ADDED Requirements

### Requirement: Session-card details collapse by default
On desktop, the dashboard SHALL render each session card in a compact state by
default. The compact surface SHALL retain the session identity and all existing
operator-attention signals needed for scanning the sidebar. The detailed
subcard region SHALL be hidden until the operator explicitly expands that card.

#### Scenario: Compact card hides secondary detail subcards
- **GIVEN** a desktop session card with OpenSpec and other detail subcards
- **WHEN** the card first renders
- **THEN** the card SHALL expose a “Show details” control with
  `aria-expanded="false"`
- **AND** the detailed OpenSpec/pipeline surface SHALL not be visible
- **AND** the session title and status indicator SHALL remain visible

#### Scenario: Operator expands a session card
- **GIVEN** a compact desktop session card
- **WHEN** the operator activates its details control
- **THEN** the card SHALL expose the existing detail subcards in their current
  order
- **AND** the control SHALL report `aria-expanded="true"` and offer “Hide
  details”

### Requirement: Compact mode preserves attention routing
Collapsing secondary details SHALL NOT hide a session error, retry, user-input
indicator, unread marker, OpenSpec activity badge, or active-process summary
that the existing session-card scan surface presents.

#### Scenario: Attention signal on a compact card
- **GIVEN** a session has an operator-attention signal
- **WHEN** its details region is compact
- **THEN** the signal SHALL remain visible without expanding the card

### Requirement: Details toggle does not select the card
The details control SHALL be a keyboard-accessible native button and SHALL NOT
invoke the session-card selection action when activated.

#### Scenario: Toggle expansion preserves selection
- **GIVEN** a compact card that is not selected
- **WHEN** the operator activates its details control
- **THEN** the card SHALL expand
- **AND** the dashboard SHALL NOT select that session solely because of the
  toggle activation
