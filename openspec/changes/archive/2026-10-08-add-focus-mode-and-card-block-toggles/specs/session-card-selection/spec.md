## MODIFIED Requirements

### Requirement: Selected session card visual indicator
The currently selected session card SHALL have a clearly visible visual indicator distinguishing it from unselected cards. On desktop the indicator SHALL combine the blue border + outer ring with an animated iridescent rim and an outside-only glow halo; the card interior SHALL keep the neutral card surface `--bg-primary` (no blue fill — the rim carries the signal).

The iridescent layers SHALL be implemented as `aria-hidden` overlay elements rendered inside the selected desktop card root (`.card-selected-ring`):

- A rim layer `.card-ring-fx` drawn at `inset: calc(-1 * var(--neon-rim-width))` with `padding: var(--neon-rim-width)`, masked to a ring of width `--neon-rim-width` via the `linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)` mask-composite (xor / exclude) trick.
- Two glow layers (`.card-glow-fx` inner, `.card-glow-fx.card-glow-fx-outer` outer), each carrying the same conic gradient with `filter: blur(...)` and `opacity: var(--neon-glow-opacity)`, and each wrapped in a NON-rotating `.card-glow-mask` wrapper that carries the same content-box xor mask with its content box equal to the card rect, so that the glow is visible ONLY outside the card edge.

The card interior (the area inside the card's border box) SHALL NOT be covered by any chromatic glow; its only background SHALL be `--bg-primary`, the same surface as an unselected card.

Each layer's conic gradient SHALL rotate via `transform: rotate()` driven by `@keyframes neon-rotate { to { transform: rotate(360deg); } }` over a 13 s linear infinite cycle, applied to the layer's `::before`. The mask SHALL NOT be applied to the rotating element.

The four palette stops SHALL be `rgb(59 130 246 / α)`, `rgb(139 92 246 / α)`, `rgb(236 72 153 / α)`, `rgb(34 211 238 / α)`, with `α = var(--neon-rim-alpha)` on the rim and `α = var(--neon-glow-alpha)` on the glow.

The token values SHALL be:

| Variable | Default (dark) | `[data-theme="light"]` override |
|---|---|---|
| `--neon-rim-width` | `3px` | `3px` |
| `--neon-rim-alpha` | `0.75` | `0.75` |
| `--neon-glow-alpha` | `0.10` | `0.30` |
| `--neon-glow-blur` | `8px` | `11px` |
| `--neon-glow-opacity` | `0.42` | `0.65` |

The blue border + ring SHALL be preserved as a static layer underneath the animated rim. When `prefers-reduced-motion: reduce` is active, the rim and glow SHALL render without animation; both SHALL remain visible. When the `fx-selected-glow` effect resolves off (see `card-visual-effects`), the iridescent rim and glow layers SHALL NOT be displayed or animated and the selected card SHALL show only the static blue border + outer ring. When the browser fails `@supports (background: conic-gradient(from 0deg, red, blue))`, the rim SHALL render as a flat `rgba(96,165,250,.5)` ring and the glow wrappers SHALL be hidden.

The card content SHALL stack above all iridescent layers; the rim, glow wrappers and drag bead SHALL remain `position: absolute` despite the `.card-selected-ring > *` rule. The card root SHALL declare `isolation: isolate`.

No ancestor of a selected desktop card in the session list SHALL clip the outside glow halo: every clipping ancestor (the folder `.group-collapse > *` collapse wrapper, the `overflow-y-auto` list scroller) SHALL leave at least 14px (the `.card-glow-mask-outer` extent) between the card's right edge and its clip edge, without reducing the card content width set by the collapse wrapper. The folder collapse wrapper SHALL still collapse to 0 height.

#### Scenario: Selected session card on desktop carries the iridescent ring
- **WHEN** a session card is the currently selected session on desktop
- **THEN** the card root SHALL carry the `card-selected-ring` class
- **AND** the card SHALL contain a `.card-ring-fx` overlay masked to a `--neon-rim-width` ring
- **AND** each `.card-glow-fx` overlay SHALL be a child of a `.card-glow-mask` wrapper carrying the content-box xor mask

#### Scenario: Selected card interior is not washed by the glow
- **WHEN** a desktop session card is selected in either theme
- **THEN** no glow layer SHALL paint inside the card's border box
- **AND** text inside the card SHALL be rendered over `--bg-primary` only (no blue fill)

#### Scenario: Outside halo is not clipped by the session list
- **WHEN** a desktop session card inside an expanded folder group is selected
- **THEN** the clip edge of every clipping ancestor SHALL be at least 14px right of the card's right edge
- **AND** a collapsed folder group SHALL still render at 0 height

#### Scenario: Unselected session card has no ring
- **WHEN** a session card is not selected
- **THEN** the card SHALL render with the default border and background (no rim, no glow)

#### Scenario: Selected session card on mobile keeps existing blue highlight only
- **WHEN** a session card is the currently selected session on mobile
- **THEN** the card SHALL render with the existing blue border + tint + ring tokens
- **AND** the card SHALL NOT render the iridescent rim or glow

#### Scenario: Reduced-motion users get static rim
- **WHEN** the user agent reports `prefers-reduced-motion: reduce`
- **AND** a desktop session card is selected
- **THEN** the rim and glow `::before` layers SHALL render without animation
- **AND** the rim and glow SHALL remain visible

#### Scenario: Light-theme alpha override
- **WHEN** `[data-theme="light"]` is set on the document root
- **AND** a desktop session card is selected
- **THEN** the rim SHALL render with `--neon-rim-width: 3px` and `--neon-rim-alpha: 0.75`
- **AND** the glow SHALL render with `--neon-glow-alpha: 0.30`, `--neon-glow-blur: 11px`, `--neon-glow-opacity: 0.65`

#### Scenario: Browsers without @property fall back to static rim with breathing glow
- **WHEN** the browser fails the `@supports (background: conic-gradient(from 0deg, red, blue))` test
- **AND** a desktop session card is selected
- **THEN** the rim SHALL render as a flat `rgba(96,165,250,.5)` ring
- **AND** the `.card-glow-mask` wrappers SHALL NOT be displayed

#### Scenario: Selected card remains visible while scrolling
- **WHEN** the user scrolls the session list
- **THEN** the selected card's highlight SHALL be immediately recognizable without careful inspection

#### Scenario: Glow effect off
- **GIVEN** `fx-selected-glow` resolves off
- **WHEN** a desktop session card is selected
- **THEN** the card SHALL render the static blue border + outer ring
- **AND** no `.card-ring-fx` or `.card-glow-fx` layer SHALL be displayed or animated
