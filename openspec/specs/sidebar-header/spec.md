# sidebar-header Specification

## Purpose

Sidebar header renders two rows: app-level controls (logo, theme, install, tunnel, server selector, settings) and filter controls (folder + session search, hidden/active toggles).
## Requirements
### Requirement: Two-row header layout
The sidebar header SHALL render as two distinct rows within a single border-bottom container.

#### Scenario: Row 1 contains app-level controls
- **WHEN** the sidebar header renders
- **THEN** the first row SHALL contain a left-aligned group of π logo, ThemePicker, and ThemeToggle; and a right-aligned group of InstallButton (conditional), TunnelButton, ServerSelector (headerExtra, conditional), and Settings gear icon

#### Scenario: Row 2 contains filter controls
- **WHEN** the sidebar header renders
- **THEN** the second row SHALL contain the folder-filter and session-search inputs and the "Active only" and "Show hidden" toggle buttons
- **AND** the second row SHALL NOT contain a folder Pin+ button (relocated to the scroll list per `dashboard-add-buttons`)

#### Scenario: Row spacing
- **WHEN** both rows render
- **THEN** row 1 SHALL use compact padding and row 2 SHALL use normal padding, with no visible divider between them

### Requirement: All existing controls preserved
The header controls SHALL remain present and functional after the layout change, except the folder Pin+ button which relocates to the scroll list.

#### Scenario: No controls removed except Pin+
- **WHEN** the sidebar header renders with all features enabled
- **THEN** all of the following SHALL be present: π logo, ThemePicker, ThemeToggle, "Active only" toggle, "Show hidden" toggle, InstallButton, TunnelButton, headerExtra (ServerSelector), Settings gear
- **AND** the folder Pin+ button SHALL NOT be present in the header

#### Scenario: Conditional controls still conditional
- **WHEN** InstallButton conditions are not met (already installed or not installable)
- **THEN** InstallButton SHALL not render, same as current behavior

