## MODIFIED Requirements

### Requirement: Dialog action button intents

The `Dialog.Action` button SHALL accept `intent="primary" | "danger" |
"neutral"` (default `primary`) and apply visually distinct styles per
intent. The primary fill SHALL be `--accent-solid` (the contract's
primary-button fill, 5.17:1 against white text), not `--accent-primary`,
which measures 3.68:1 against white in every theme. (Found by the
add-pi-spec-driven-schema UX review; applies to every dialog.)

#### Scenario: Primary intent uses accent

- **WHEN** a `Dialog.Action` is rendered with `intent="primary"` (or no
  intent)
- **THEN** the button SHALL apply `bg-[var(--accent-solid)]` with white
  text and a hover state
- **AND** its text SHALL meet 4.5:1 against its background in base dark,
  base light and nord dark

#### Scenario: Danger intent uses red

- **WHEN** a `Dialog.Action` is rendered with `intent="danger"`
- **THEN** the button SHALL apply `bg-red-600` with `hover:bg-red-500`

#### Scenario: Neutral intent matches Cancel

- **WHEN** a `Dialog.Action` is rendered with `intent="neutral"`
- **THEN** the button SHALL apply the same border + transparent
  background as `Dialog.Cancel`
