## MODIFIED Requirements

### Requirement: Process group rows use the dock row primitive

The runtime SHALL export a `ComposerDockRow` primitive taking `{ icon, title, detail?, meta?, startedAt?, actions?, onTitleActivate?, titleLabel? }` that renders one Processes-lane row with the dock's spacing and truncation, and renders the elapsed time since `startedAt` itself. The primitive SHALL give every action a target of at least 24×24 CSS px (44×44 at phone width) without help from the contribution. Contributions SHALL render their rows with it; a row's elapsed time SHALL NOT be inside a live region. When `onTitleActivate` is given, the title SHALL render as a button named by `titleLabel` (falling back to `title`) that keeps the title's truncation and target size; without it the title SHALL render exactly as before.

#### Scenario: Plugin row matches core rows
- **WHEN** a contribution renders a row through `ComposerDockRow` beside a core background-process row
- **THEN** both rows SHALL share the same height, icon size, truncation and action target sizes

#### Scenario: Phone-width plugin row targets
- **WHEN** a contribution passes a 16 px icon button as a row action and the dock renders at a 375 px viewport
- **THEN** that action's target SHALL measure at least 44×44 CSS px

#### Scenario: Plugin elapsed time is silent
- **WHEN** a contributed row's elapsed time advances
- **THEN** no live region SHALL change its content

#### Scenario: Activatable title
- **WHEN** a row is rendered with `title = "App.tsx"`, `titleLabel = "Open packages/client/src/App.tsx in editor"` and `onTitleActivate`
- **THEN** the title SHALL be a button with that accessible name, activating it SHALL call `onTitleActivate` once, and it SHALL truncate like a plain title

#### Scenario: Plain title unchanged
- **WHEN** a row is rendered without `onTitleActivate`
- **THEN** its title SHALL NOT be interactive
