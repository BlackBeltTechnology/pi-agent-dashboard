## ADDED Requirements

### Requirement: Single severity token set
The client SHALL define a `--severity-{error,warning,success,info,neutral}` CSS custom-property set in `index.css`, each deriving from an existing `--accent-*` (or `--text-muted`) token. This set SHALL be the single source of truth for color-by-severity across every message and status surface.

#### Scenario: Tokens resolve in every theme
- **WHEN** any theme is active
- **THEN** all five `--severity-*` tokens SHALL resolve to a defined color
- **AND** they SHALL derive from theme-aware accents so named-theme overrides flow without per-surface edits

#### Scenario: Severity → accent mapping
- **WHEN** the token set is defined
- **THEN** `--severity-error` SHALL map to `--accent-red`, `--severity-warning` to `--accent-orange`, `--severity-success` to `--accent-green`, `--severity-info` to `--accent-blue`, and `--severity-neutral` to `--text-muted`

### Requirement: Warning is visually distinct from working
The `warning` severity SHALL use orange (`--accent-orange`), NOT the yellow used by `--status-working`, so "caution" and "busy" remain distinguishable.

#### Scenario: Warning does not reuse working-yellow
- **WHEN** a `warning` surface and a `working` status surface are visible together
- **THEN** their colors SHALL differ (orange vs yellow)

### Requirement: No raw severity color literals in message components
Message components (`Toast`, `SpawnErrorToastHost`) SHALL source severity color from `--severity-*` tokens, NOT from raw Tailwind literals such as `bg-red-900`.

#### Scenario: Component inspection finds no hardcoded severity color
- **WHEN** `Toast.tsx` and `SpawnErrorToastHost.tsx` are inspected
- **THEN** severity backgrounds/borders/text SHALL derive from `--severity-*` (directly or via a class map), not inline `red-900`/`green-900` literals
