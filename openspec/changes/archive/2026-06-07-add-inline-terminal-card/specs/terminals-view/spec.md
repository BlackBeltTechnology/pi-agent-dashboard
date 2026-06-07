## MODIFIED Requirements

### Requirement: Tabbed terminal container
The TerminalsView SHALL display a horizontal tab bar at the top showing all **non-ephemeral** terminal sessions for the current folder. Terminal sessions marked `ephemeral` (inline terminals) SHALL be excluded from the tab bar. Each tab SHALL show the terminal name (PTY title or shell name). The active tab SHALL have a visual indicator. Below the tab bar, the selected terminal's xterm.js view SHALL be displayed.

#### Scenario: Multiple terminals displayed as tabs
- **WHEN** a folder has 3 non-ephemeral terminal sessions
- **THEN** the tab bar SHALL show 3 tabs with terminal names
- **THEN** the active tab SHALL be visually highlighted
- **THEN** the content area below SHALL show the active terminal's xterm.js output

#### Scenario: Single terminal
- **WHEN** a folder has 1 non-ephemeral terminal session
- **THEN** the tab bar SHALL show 1 tab
- **THEN** that tab SHALL be active by default

#### Scenario: Ephemeral terminals excluded
- **WHEN** a folder has 1 non-ephemeral terminal and 2 ephemeral (inline) terminals
- **THEN** the tab bar SHALL show only 1 tab
- **THEN** the ephemeral terminals SHALL NOT appear in the tab bar

#### Scenario: No terminals
- **WHEN** a folder has no non-ephemeral terminal sessions
- **THEN** the TerminalsView SHALL display an empty state message (e.g., "No terminals. Click + New to create one.")
