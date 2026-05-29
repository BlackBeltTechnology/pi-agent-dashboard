## MODIFIED Requirements

### Requirement: Selected session card visual indicator
The currently selected session card SHALL have a clearly visible visual indicator distinguishing it from unselected cards. The indicator SHALL combine the existing blue border + subtle blue background tint + outer ring glow with a new animated iridescent rim layer.

The iridescent rim SHALL be implemented as two pseudo-elements on the selected card:

- A border-rim layer (`::before`) drawn at `inset: -1px` carrying a `conic-gradient(from var(--neon-angle), <blue>, <purple>, <pink>, <cyan>, <blue>)` masked to a 1 px ring via the standard `linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)` mask-composite trick.
- A glow layer (`::after`) drawn at `inset: -3px` carrying the same conic gradient with `filter: blur(<--neon-glow-blur>)` and `opacity: var(--neon-glow-opacity)`.

The conic gradient's start angle SHALL be animated via the CSS `@property --neon-angle` declaration (`syntax: "<angle>"`, `inherits: false`, `initial-value: 0deg`), driven by `@keyframes neon-rotate { to { --neon-angle: 360deg; } }` over a 13 s linear infinite cycle.

The four palette stops SHALL be `rgb(59 130 246 / α)`, `rgb(139 92 246 / α)`, `rgb(236 72 153 / α)`, `rgb(34 211 238 / α)`, with `α = var(--neon-rim-alpha)` on the rim and `α = var(--neon-glow-alpha)` on the glow.

The default (dark-theme) alpha values SHALL be:

| Variable | Default (dark) | `[data-theme="light"]` override |
|---|---|---|
| `--neon-rim-alpha` | `0.45` | `0.50` |
| `--neon-glow-alpha` | `0.10` | `0.18` |
| `--neon-glow-blur` | `8px` | `11px` |
| `--neon-glow-opacity` | `0.42` | `0.52` |

The existing blue tint and border SHALL be preserved as a fallback / static layer underneath the animated rim. When `prefers-reduced-motion: reduce` is active, the rim and glow SHALL render in their initial position (angle 0deg) without animation; both layers SHALL remain visible. The fallback `@supports not (background: conic-gradient(from 0deg, red, blue))` block SHALL replace the rim with a flat `rgba(96,165,250,.5)` border and animate only the glow with a 6 s `neon-breathe` opacity pulse.

The card content SHALL stack above both rim and glow (`.card.selected > * { position: relative; z-index: 2 }`); rim is `z-index: 1`, glow is `z-index: 0`. The card root SHALL declare `isolation: isolate` so the layers do not interact with the page-level stacking context.

#### Scenario: Selected session card on desktop carries the iridescent ring
- **WHEN** a session card is the currently selected session
- **THEN** the card root SHALL carry the `selected` class token
- **AND** the rendered DOM SHALL include a `::before` pseudo-element drawn from a conic-gradient at `inset: -1px` masked to a 1 px ring
- **AND** the rendered DOM SHALL include a `::after` pseudo-element drawn from the same conic-gradient at `inset: -3px` with `filter: blur(--neon-glow-blur)`

#### Scenario: Unselected session card has no ring
- **WHEN** a session card is not selected
- **THEN** the card SHALL render with the default border and background (no ring, no glow)

#### Scenario: Selected session card on mobile keeps existing blue highlight only
- **WHEN** a session card is the currently selected session on mobile
- **THEN** the card SHALL render with the existing blue border + tint + ring tokens
- **AND** the card SHALL NOT render the iridescent rim or glow (animation is desktop-only to keep mobile battery cost down)

#### Scenario: Reduced-motion users get static rim
- **WHEN** the user agent reports `prefers-reduced-motion: reduce`
- **AND** a desktop session card is selected
- **THEN** the `--neon-angle` SHALL remain at its `initial-value: 0deg`
- **AND** both pseudo-elements SHALL render without animation
- **AND** the rim and glow SHALL remain visible

#### Scenario: Light-theme alpha override
- **WHEN** `[data-theme="light"]` is set on the document root
- **AND** a desktop session card is selected
- **THEN** the rim SHALL render with `--neon-rim-alpha: 0.50`
- **AND** the glow SHALL render with `--neon-glow-alpha: 0.18`, `--neon-glow-blur: 11px`, `--neon-glow-opacity: 0.52`

#### Scenario: Browsers without @property fall back to static rim with breathing glow
- **WHEN** the browser does not support `@property` (fails the `@supports (background: conic-gradient(from 0deg, red, blue))` test)
- **AND** a desktop session card is selected
- **THEN** the rim SHALL render as a flat `rgba(96,165,250,.5)` border
- **AND** the glow SHALL animate via the `neon-breathe` 6 s opacity pulse (35 % → 65 % → 35 %)

#### Scenario: Selected card remains visible while scrolling
- **WHEN** the user scrolls the session list
- **THEN** the selected card's highlight SHALL be immediately recognizable without careful inspection
