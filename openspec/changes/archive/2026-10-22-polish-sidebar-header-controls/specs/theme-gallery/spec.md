## MODIFIED Requirements

### Requirement: Theme picker UI
The client SHALL display a theme picker dropdown in the sidebar header area, opened from the Appearance trigger, with the System/Light/Dark mode control inside it (per `sidebar-header` "Appearance popover"). The dropdown SHALL show each theme name with a color swatch preview (a tile showing the theme's primary background and accent colors). The currently selected theme SHALL have a visual indicator that does not rely on colour alone (the selected-chip fill and border and a bolder name).

#### Scenario: Open theme picker
- **WHEN** the user clicks the Appearance trigger
- **THEN** a dropdown SHALL appear listing all available themes with color swatches

#### Scenario: Select theme
- **WHEN** the user clicks a theme in the dropdown
- **THEN** the theme SHALL be applied immediately and the dropdown SHALL close

#### Scenario: Current theme indicated
- **WHEN** the theme picker dropdown is open
- **THEN** the currently active theme SHALL show a highlight (selected-chip fill and border, semibold name)

#### Scenario: Close dropdown
- **WHEN** the user clicks outside the theme picker dropdown
- **THEN** the dropdown SHALL close
