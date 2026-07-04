# panel-elevation Specification

## ADDED Requirements

### Requirement: Per-mode elevation-highlight token

The client SHALL define a theme-agnostic CSS custom property `--elevation-rim` used for the inset top-highlight of beveled panels. It SHALL resolve per color mode and SHALL NOT vary by named theme.

#### Scenario: Dark mode value
- **WHEN** the app is in dark mode (no `[data-theme="light"]` on the root)
- **THEN** `--elevation-rim` SHALL resolve to `rgba(255, 255, 255, 0.10)`

#### Scenario: Light mode value
- **WHEN** the app is in light mode (`[data-theme="light"]` on the root)
- **THEN** `--elevation-rim` SHALL resolve to `rgba(255, 255, 255, 0.9)`

#### Scenario: Token is theme-independent
- **WHEN** any of the nine named themes is active
- **THEN** `--elevation-rim` SHALL keep its per-mode value and SHALL NOT be overridden by the named theme's variable map

### Requirement: Session card neutral panel bevel

Each desktop and mobile session card SHALL render with a neutral panel bevel: an inset top-edge highlight using `--elevation-rim` plus a drop shadow using `--shadow-card`. The bevel SHALL NOT introduce any status or accent color.

#### Scenario: Unselected card bevel
- **WHEN** an unselected session card is rendered
- **THEN** its box-shadow SHALL include `inset 0 1px 0 var(--elevation-rim)` and a drop shadow `0 4px 8px var(--shadow-card)`

#### Scenario: Bevel adds no color
- **WHEN** any session card is rendered in Tier-1 scope
- **THEN** the card SHALL NOT display a status-colored top rim or an accent-tinted glow beyond the existing selected-card treatment

#### Scenario: Hover behavior preserved
- **WHEN** an unselected card is hovered
- **THEN** the existing hover lift/shadow behavior (`hover:-translate-y-0.5`, `hover:shadow-lg`) SHALL still apply on top of the bevel

### Requirement: Folder and workspace header bevel

The folder header bar and the workspace header bar SHALL render with the same neutral bevel recipe as cards, using `--elevation-rim` for the inset highlight.

#### Scenario: Folder header bevel
- **WHEN** a folder header bar is rendered
- **THEN** its box-shadow SHALL include `inset 0 1px 0 var(--elevation-rim)` and a drop shadow `0 2px 4px var(--shadow-card)`

#### Scenario: Workspace header bevel
- **WHEN** a workspace header bar is rendered
- **THEN** its box-shadow SHALL include `inset 0 1px 0 var(--elevation-rim)` and a drop shadow `0 2px 4px var(--shadow-card)`

### Requirement: Session name typographic weight

The session name SHALL render at font-weight 600 in both the desktop and mobile card layouts, matching the folder title weight, to establish scannable title hierarchy across both color modes.

#### Scenario: Desktop session name weight
- **WHEN** a session card is rendered in the desktop layout
- **THEN** the session-name element SHALL have `font-weight: 600`

#### Scenario: Mobile session name weight
- **WHEN** a session card is rendered in the mobile layout
- **THEN** the session-name element SHALL have `font-weight: 600`

### Requirement: Selected-card treatment unchanged

The Tier-1 elevation system SHALL NOT alter the existing selected-card treatment (border, background tint, ring, and rotating glow overlays). The selected card SHALL remain the single most-differentiated element in the list so that added depth on unselected cards does not reduce selection salience.

#### Scenario: Selected card retains its treatment
- **WHEN** the currently selected session card is rendered
- **THEN** it SHALL keep its existing border/tint/ring and `card-glow-fx` / `card-ring-fx` overlays, and SHALL additionally carry the inset elevation highlight without any glow boost

#### Scenario: Selection dominance preserved
- **WHEN** the sidebar renders a mix of unselected beveled cards and one selected card
- **THEN** the selected card SHALL remain visually dominant over every unselected card
