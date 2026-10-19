## MODIFIED Requirements

### Requirement: Dialog visual baseline

The `Dialog` SHALL render with a single, consistent visual baseline: overlay
tint from the theme's `--bg-overlay` token, a container drawn with the card
recipe (`--bg-secondary` background, `--border-secondary` border, extra-large
rounded corners, raised elevation), a title at the contract's title step
(`text-lg`, semibold), and a single fixed layer on the `z-dialog` step of the
overlay scale. A header icon SHALL sit in a tile coloured with a severity
triple: error when the dialog's action is destructive, info otherwise.

#### Scenario: Overlay tint

- **WHEN** a `Dialog` is open
- **THEN** the overlay element SHALL be tinted with `var(--bg-overlay)`
- **AND** SHALL NOT use a fixed black tint

#### Scenario: Container chrome

- **WHEN** a `Dialog` is open
- **THEN** the dialog container SHALL apply `bg-[var(--bg-secondary)]`,
  `border-[var(--border-secondary)]` and `rounded-xl`

#### Scenario: Title step

- **WHEN** a `Dialog` renders a title
- **THEN** the title SHALL use `text-lg` and `font-semibold`

#### Scenario: z-index layer

- **WHEN** a `Dialog` is open
- **THEN** the dialog root SHALL sit on the `z-dialog` layer, above
  `MobileOverlay`

### Requirement: Dialog action button intents

The `Dialog.Action` button SHALL accept `intent="primary" | "danger" |
"neutral"` (default `primary`) and apply visually distinct styles per
intent. The primary fill SHALL be `--accent-solid` (the contract's
primary-button fill, 5.17:1 against white text), not `--accent-primary`,
which measures 3.68:1 against white in every theme. (Found by the
add-pi-spec-driven-schema UX review; applies to every dialog.) The danger
intent SHALL use the red tint triple (`--tint-red-bg`, `--tint-red-fg`,
`--tint-red-border`), not a raw palette fill. Every action and `Dialog.Cancel`
SHALL be at least 44 px tall below the `sm` breakpoint and at least 36 px
from `sm`, with semibold text.

#### Scenario: Primary intent uses accent

- **WHEN** a `Dialog.Action` is rendered with `intent="primary"` (or no
  intent)
- **THEN** the button SHALL apply `bg-[var(--accent-solid)]` with white
  text and a hover state
- **AND** its text SHALL meet 4.5:1 against its background in base dark,
  base light and nord dark

#### Scenario: Danger intent uses red

- **WHEN** a `Dialog.Action` is rendered with `intent="danger"`
- **THEN** the button SHALL apply the `--tint-red-bg`, `--tint-red-fg` and
  `--tint-red-border` tokens
- **AND** SHALL NOT apply `bg-red-600`
- **AND** its text SHALL meet 4.5:1 against its background in base dark,
  base light and nord dark

#### Scenario: Neutral intent matches Cancel

- **WHEN** a `Dialog.Action` is rendered with `intent="neutral"`
- **THEN** the button SHALL apply the same border + transparent
  background as `Dialog.Cancel`

#### Scenario: Action target size

- **WHEN** a dialog's actions render in a 375 px viewport
- **THEN** each action and the Cancel button SHALL be at least 44 px tall
- **AND** from the `sm` breakpoint each SHALL be at least 36 px tall

## ADDED Requirements

### Requirement: Dialog close control meets the target size

The standard close button on a non-flush dialog SHALL be at least 44 by 44 px below the `sm` breakpoint and at least 36 by 36 px from `sm`. It SHALL keep its accessible name and its position at the panel's top-right corner.

#### Scenario: Close button size
- **WHEN** a non-flush dialog with a title opens in a 375 px viewport
- **THEN** its close button SHALL measure at least 44 by 44 px
- **AND** it SHALL expose an accessible name such as "Close"
