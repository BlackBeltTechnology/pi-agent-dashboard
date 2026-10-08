## MODIFIED Requirements

### Requirement: Card status stripes are compositor-only

The scrolling status stripes on running, unread, and ask_user (waiting-for-question) session cards (`card-working-pulse`, `card-unread-pulse`, `card-input-stripes`) MUST animate via a compositor-only property (`transform`) over a static repeating gradient, rather than animating `background-position` (which forces a per-frame repaint of every active card). The ask_user state MUST use the same scrolling-stripe mechanism in the question color (purple), replacing the prior `background-color` tint pulse (`card-input-pulse`); the three states MUST share one set of transform keyframes and differ only by gradient color (running=yellow, unread=cyan, ask_user=purple). The accompanying opacity pulse MAY remain (opacity is compositor-only). The translation MUST loop seamlessly over one tile period and MUST be clipped to the card so the tile does not bleed past the border. The `prefers-reduced-motion` guard MUST be preserved. When the `fx-status-animation` effect resolves off, the stripe overlay MUST NOT animate and MUST render as a static tint in the state's color instead of the repeating gradient.

#### Scenario: running-card stripes scroll without per-frame repaint

- **GIVEN** a session card with active (running) status and its scrolling stripes
- **WHEN** the stripe animation runs
- **THEN** the stripes SHALL scroll via a `transform` on a static gradient overlay
- **AND** `background-position` SHALL NOT be animated
- **AND** the scrolling SHALL look equivalent to the prior implementation with no tile bleed past the card border

#### Scenario: ask_user card uses purple stripes

- **GIVEN** a session whose current tool is `ask_user` (and no widget-bar slot owns the prompt)
- **WHEN** the card status indicator renders
- **THEN** the card SHALL show scrolling stripes in the question color (purple) via the shared `transform`-based mechanism
- **AND** it SHALL NOT use a `background-color` tint pulse

#### Scenario: stripes pause when hidden and under reduced motion

- **GIVEN** running or unread cards with scrolling stripes
- **WHEN** the document becomes hidden OR `prefers-reduced-motion: reduce` is active
- **THEN** the stripe animation SHALL be paused or disabled

#### Scenario: effects off removes the stripe layer

- **GIVEN** `fx-status-animation` resolves off
- **WHEN** a running, unread or ask_user card renders
- **THEN** the stripe overlay SHALL NOT animate and SHALL NOT render the repeating gradient
- **AND** the card SHALL show a static yellow, cyan or purple tint respectively
