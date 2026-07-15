## ADDED Requirements

### Requirement: GFM table visual styling

Rendered GFM tables in `.markdown-content` SHALL use a shared style that reads
legibly on every theme and on every surface that renders markdown (chat view,
editor-pane content view, KB, resources). The `<table>` SHALL render with an
outer border in `var(--border-secondary)`, `border-radius: 8px`, and clipped
overflow so inner fills follow the rounded corners. Header cells (`thead th`)
SHALL use `background: var(--bg-surface)` with `var(--text-primary)` text and a
`var(--border-secondary)` bottom border. Body rows SHALL be zebra-striped: every
even `tbody` row SHALL use `background: var(--table-stripe)`, a theme-driven token
defined for every theme in both dark and light modes. Body cells SHALL separate
with `var(--border-primary)` horizontal borders (suppressed on the last row) and
`var(--border-primary)` vertical column separators between adjacent cells. Hovering
a body row SHALL highlight it with `background: var(--bg-hover)`. The style SHALL
be defined once on the `.markdown-content` scope so no surface diverges.

#### Scenario: Zebra-striped body rows

- **WHEN** a GFM table with three or more body rows renders in `.markdown-content`
- **THEN** even-numbered body rows SHALL have `background: var(--table-stripe)` and
  odd rows SHALL be unstyled, producing visible row banding

#### Scenario: Elevated, separated header

- **WHEN** a GFM table renders on any theme
- **THEN** the header row SHALL use `var(--bg-surface)` (not `var(--bg-tertiary)`),
  so it reads as distinct from the surrounding message/container background

#### Scenario: Rounded clipped frame

- **WHEN** a GFM table renders
- **THEN** the table SHALL have an 8px rounded outer border and its header fill and
  row stripes SHALL be clipped to those rounded corners (via
  `border-collapse: separate` + `overflow: hidden`)

#### Scenario: Kept column separators

- **WHEN** a GFM table with two or more columns renders
- **THEN** adjacent cells SHALL be divided by a `var(--border-primary)` vertical
  border, and the last column SHALL have none

#### Scenario: Theme-driven stripe token defined for every theme

- **WHEN** any of the 9 themes is applied in dark or light mode
- **THEN** `--table-stripe` SHALL resolve to a defined value for that theme/mode,
  so the zebra banding renders on every palette
