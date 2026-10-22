## MODIFIED Requirements

### Requirement: Sidebar action button contrast
Icon-only sidebar header buttons (the Discord link, the Appearance trigger, the Focus toggle and the Settings gear in row 1, and the filter funnel in row 2) SHALL follow the `sidebar-header` icon-button recipe: `--text-secondary` for their default color and `--text-primary` for their hover color, ensuring a minimum WCAG AA non-text contrast ratio of 3:1 against the sidebar background in both light and dark themes.

#### Scenario: Light mode icon visibility
- **WHEN** the theme is light and the sidebar renders action buttons
- **THEN** each icon has a contrast ratio of at least 3:1 against `--bg-primary`

#### Scenario: Dark mode icon visibility
- **WHEN** the theme is dark and the sidebar renders action buttons
- **THEN** each icon has a contrast ratio of at least 3:1 against `--bg-primary`

#### Scenario: Hover state contrast
- **WHEN** the user hovers over a sidebar action button in any theme
- **THEN** the icon color changes to `--text-primary`
