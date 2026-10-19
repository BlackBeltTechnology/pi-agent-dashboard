## ADDED Requirements

### Requirement: Settings rail meets contrast and marks state without colour alone

In the settings navigation rail:

- inactive items, group labels, sub-item controls and plugin child rows SHALL use the secondary or primary text colour, never the muted text colour, and SHALL NOT be dimmed with opacity;
- the current item (`aria-current="page"`) SHALL be marked by a tertiary background, semibold primary text, and an accent-coloured inset bar at its leading edge;
- the Services attention marker SHALL be a severity icon (a shape, not a dot) with its existing accessible label;
- the existing dirty indicators and plugin health dots keep their shape and labels, as their own requirements specify, but SHALL take their colour from severity tokens;
- rail items SHALL be at least 44 px tall below the `sm` breakpoint and at least 36 px tall from `sm`;
- in the horizontal strip shown below `md`, the current item SHALL keep the tertiary fill and semibold text, with the accent bar on its bottom edge.

The rail SHALL use no raw palette classes or hex/rgba literals. All rail text SHALL meet 4.5:1 contrast against the rail background in base dark, base light and nord dark.

#### Scenario: Inactive items readable
- **WHEN** the rail renders in base light
- **THEN** every inactive item label SHALL measure at least 4.5:1 against the rail background

#### Scenario: Current item marked by more than colour
- **WHEN** the user is on `/settings/services`
- **THEN** the Services item SHALL carry `aria-current="page"`
- **AND** it SHALL show the tertiary background, semibold text and the leading accent bar

#### Scenario: Attention marker is a labelled icon
- **WHEN** a service needs attention
- **THEN** the Services rail item SHALL show an error severity icon
- **AND** its accessible text SHALL still announce how many services need attention

#### Scenario: Dirty indicator uses a token
- **WHEN** a page has unsaved changes
- **THEN** its `nav-dirty-<id>` indicator SHALL render with a severity token colour and no raw palette class

#### Scenario: Mobile strip marks the current item
- **WHEN** the settings page renders at 375 px wide on `/settings/services`
- **THEN** the Services item in the horizontal strip SHALL be at least 44 px tall
- **AND** it SHALL show the tertiary fill, semibold text and an accent bar on its bottom edge

#### Scenario: Desktop rail item height
- **WHEN** the rail renders at 1280 px wide
- **THEN** every rail item SHALL be at least 36 px tall

#### Scenario: Rail contains no raw colour
- **WHEN** the rendered rail element is scanned for raw palette classes and hex/rgba literals in class names and inline styles
- **THEN** no match SHALL be found

#### Scenario: Promoted plugin row keeps its hint without dimming
- **WHEN** a plugin row links to a page promoted into another rail group
- **THEN** the row SHALL render without reduced opacity, in the secondary text colour
- **AND** it SHALL show the "↗ <group>" hint at least 12 px

### Requirement: Settings kit provides the shared notice extensions and inline action error

`@blackbelt-technology/dashboard-plugin-runtime` SHALL export, next to `SettingsNotice` and `SettingsStatusPill`, an inline action error component. The component takes a sentence, an optional raw detail, and an id that the failed control references through `aria-describedby`. `SettingsNotice` SHALL accept remedy rows (icon plus sentence, links allowed), rendered in the order given, and SHALL expose `aria-busy="true"` while its retry is in flight. `SettingsStatusPill` SHALL accept a spinning option that animates its icon, except under `prefers-reduced-motion`. Existing `SettingsNotice` and `SettingsStatusPill` props SHALL keep working unchanged.

#### Scenario: Existing notice call sites unaffected
- **WHEN** a plugin renders `SettingsNotice` with only `tone`, `children` and `onRetry`
- **THEN** it SHALL render as before this change

#### Scenario: Action error is exported and linked
- **WHEN** a plugin renders the inline action error with id `stop-err` under a button that has `aria-describedby="stop-err"`
- **THEN** the error SHALL have id `stop-err` and the alert role
