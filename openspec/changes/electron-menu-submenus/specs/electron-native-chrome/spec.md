## MODIFIED Requirements

### Requirement: Application Menu

The application menu SHALL provide About, update-check, Doctor, and remote-connection actions, with a full native menu on macOS and grouped Dashboard/Edit/View/Help submenus on Windows and Linux.

#### Scenario: macOS menu structure

- **WHEN** the app menu is set up on macOS
- **THEN** the app-named submenu contains "About <app>", "Check for Updates…", "View Update Log", "Doctor...", "Connect to Remote Dashboard…", "Use Local Dashboard", the hide/hideOthers/unhide roles, and Quit
- **AND** Edit, View (reload, forceReload, toggleDevTools, zoom, togglefullscreen), and Window submenus are present

#### Scenario: Windows and Linux menu structure

- **WHEN** the app menu is set up on Windows or Linux
- **THEN** the top-level items are exactly Dashboard, Edit, View, and Help
- **AND** Dashboard contains Servers, "Connect to Remote Dashboard…", "Use Local Dashboard", Runtime, Browser relay, a separator, and the quit role
- **AND** Edit contains undo, redo, cut, copy, paste, and selectAll roles
- **AND** View contains Reload `CmdOrCtrl+R`, Force Reload `CmdOrCtrl+Shift+R`, toggleDevTools, zoom, and togglefullscreen
- **AND** Help contains "Doctor", "Check for Updates…", "View Update Log", a separator, and "About"

#### Scenario: Update-check item hidden in dev

- **WHEN** running an unpackaged dev build
- **THEN** the "Check for Updates…" item is omitted (on Windows/Linux the Help menu then starts with "Doctor" followed by "View Update Log")

#### Scenario: Check for Updates result

- **WHEN** the user clicks "Check for Updates…" and the app is current
- **THEN** an info dialog reports "You're up to date"
- **AND** if the check fails, a warning dialog reports "Update check failed" with the error detail

#### Scenario: About dialog

- **WHEN** the user opens the About dialog
- **THEN** it shows the app version and description
- **AND** on a Windows install with bundled Git present, it adds a bundled Git version line and an "Open Bundled Git License" button that opens the license file when chosen

#### Scenario: View Update Log

- **WHEN** the user clicks "View Update Log"
- **THEN** the updater log file is revealed in the OS file manager, or an info dialog reports "No update log available." when none exists

#### Scenario: Doctor action

- **WHEN** the user clicks the Doctor item
- **THEN** the dedicated Doctor window opens, and a second activation focuses the existing window
