## MODIFIED Requirements

### Requirement: Doctor diagnostic function
The app SHALL provide a Doctor function accessible from the app menu that checks all required components and renders the result in a dedicated styled BrowserWindow (not a native message-box dialog).

#### Scenario: Doctor checks all components
- **WHEN** the user opens "Doctor..." from the menu
- **THEN** it SHALL check: Electron version, system Node.js, bundled Node.js, bundled npm, pi CLI, openspec CLI, dashboard server code, offline packages bundle, TypeScript loader (tsx), dashboard server status, server log presence, server launch test, setup wizard state, API key configuration, and managed install directory
- **AND** each check SHALL report status (ok/warning/error), version, path, the section it belongs to, and a remediation suggestion when the status is not ok

#### Scenario: Doctor opens a styled window
- **WHEN** the user opens "Doctor..." from the menu
- **THEN** the app SHALL open a dedicated BrowserWindow rendering the report grouped by section, with a per-row status pill, message, optional path, and optional suggestion
- **AND** the window SHALL provide toolbar actions: Re-run, Copy as Markdown, Copy as Plain text, Open server log, Open doctor log, Run setup wizard
- **AND** opening Doctor while the window is already open SHALL focus the existing window instead of creating a second one

#### Scenario: Doctor offers setup for errors
- **WHEN** the Doctor report contains fixable errors
- **THEN** the window SHALL surface a "Run setup wizard" toolbar action that triggers the setup wizard
