## ADDED Requirements

### Requirement: Settings rail meets contrast and marks state without colour alone

In the settings navigation rail:

- inactive items, group labels, sub-item controls and plugin child rows SHALL use the secondary or primary text colour, never the muted text colour, and SHALL NOT be dimmed with opacity;
- the current item (`aria-current="page"`) SHALL be marked by a tertiary background, semibold primary text, and an accent-coloured inset bar at its leading edge;
- an item that needs attention SHALL show a severity icon with an accessible label, not a colour-only dot;
- rail items SHALL be at least 44 px tall below the `sm` breakpoint and at least 36 px tall from `sm`.

The rail SHALL use no raw palette classes or hex/rgba literals. All rail text SHALL meet 4.5:1 contrast against the rail background in base dark, base light and nord dark.

#### Scenario: Inactive items readable
- **WHEN** the rail renders in base light
- **THEN** every inactive item label SHALL measure at least 4.5:1 against the rail background

#### Scenario: Current item marked by more than colour
- **WHEN** the user is on `/settings/services`
- **THEN** the Services item SHALL carry `aria-current="page"`
- **AND** it SHALL show the tertiary background, semibold text and the leading accent bar

#### Scenario: Attention marker has a label
- **WHEN** a rail item needs attention because a service has failed
- **THEN** the item SHALL show an error severity icon with an accessible label such as "Needs attention"
- **AND** no colour-only dot SHALL render

#### Scenario: Rail contains no raw colour
- **WHEN** the rendered rail element is scanned for raw palette classes and hex/rgba literals in class names and inline styles
- **THEN** no match SHALL be found

#### Scenario: Promoted plugin row keeps its hint without dimming
- **WHEN** a plugin row links to a page promoted into another rail group
- **THEN** the row SHALL render without reduced opacity, in the secondary text colour
- **AND** it SHALL show the "↗ <group>" hint at least 12 px
