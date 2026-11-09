## MODIFIED Requirements

### Requirement: Board adopts the session-card status visual language

The board SHALL render each automation as a card that reuses the dashboard's session-status visual language, so automation cards read as siblings of session cards. A card SHALL carry a status rail and status dot. Their colour comes from the theme's status and severity tokens: enabled/idle as success, running as warning with a pulse, orphaned as warning, error/invalid as error, and disabled/ended as muted. The card SHALL show the headless source icon for spawned runs and status **pill** badges (running / orphaned / enabled / disabled / invalid), each carrying a word, not colour alone. A running automation SHALL render the animated barber-pole stripe on its status rail and running pill, not across the whole card. The selected card SHALL use the ui-contract selected-chip recipe instead of the session card's neon FX: an `--accent` border, an `--accent-soft` fill on its header row only (the card body keeps `--bg-secondary`), a bold automation name, and `aria-current="true"`. The selected card SHALL NOT render the host glow or ring FX layers, and unselected cards SHALL NOT carry `aria-current`. All animations SHALL respect `prefers-reduced-motion`. Because the plugin package does not depend on the client package, it SHALL replicate the small status-to-class mapping locally and apply the host's already-global FX classes by name. It SHALL NOT import the client's `session-status-visuals` module.

#### Scenario: Running automation shows amber pulse + stripe overlay

- **WHEN** an automation has a run in `running` state
- **THEN** its status rail and dot SHALL pulse in the running colour and the barber-pole stripe SHALL animate on the rail and running pill, while the card body stays unstriped.

#### Scenario: Invalid/disabled cards use the shared muted/red palette

- **WHEN** an automation is invalid (or disabled)
- **THEN** its card SHALL use the error (or muted) status token, not a bespoke style.

#### Scenario: Reduced motion disables animations

- **WHEN** `prefers-reduced-motion: reduce` is set
- **THEN** the stripe animation SHALL be disabled while the static status colours remain.

#### Scenario: Selected card uses the selector style, not neon

- **WHEN** the user clicks an automation card
- **THEN** that card SHALL carry an `--accent` border, an `--accent-soft` header row, a bold name and `aria-current="true"`, and SHALL contain no glow or ring FX layer.

#### Scenario: Selection moves between cards

- **WHEN** one card is selected and the user clicks a different card
- **THEN** only the newly clicked card SHALL carry `aria-current="true"` and the selected styling; the previous card SHALL return to the `--border-secondary` border with no header fill.

#### Scenario: Selected running card keeps its stripe

- **WHEN** the selected card's automation has a running run
- **THEN** the rail and running-pill stripe SHALL still render, and the selection SHALL add no animated layer.

#### Scenario: Card body text keeps contrast when selected

- **WHEN** a card is selected
- **THEN** its body (schedule, last-run line, run history and their `--accent-text` links) SHALL stay on `--bg-secondary`, and only the header row SHALL paint `--accent-soft`, behind content drawn in `--text-primary` or `--text-secondary`, or on its own opaque pill, badge or button background.
