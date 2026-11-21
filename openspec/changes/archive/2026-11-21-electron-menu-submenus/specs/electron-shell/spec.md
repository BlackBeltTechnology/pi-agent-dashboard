## MODIFIED Requirements

### Requirement: macOS application menu
The Electron app SHALL set up a native macOS application menu with standard menu items.

#### Scenario: App menu structure on macOS
- **WHEN** the app starts on macOS
- **THEN** the application menu SHALL include: App name menu (About, Doctor, Separator, Quit), Edit (Undo, Cut, Copy, Paste, Select All), View (Reload, Toggle DevTools), Window (Minimize, Close)

#### Scenario: About dialog
- **WHEN** the user selects "About PI Dashboard" from the app menu
- **THEN** a native dialog SHALL display the app name, version number (from `app.getVersion()`), and copyright text

#### Scenario: App menu on Windows/Linux
- **WHEN** the app starts on Windows or Linux
- **THEN** the application menu SHALL consist of grouped Dashboard, Edit, View, and Help submenus, with "Doctor" and "About" under Help (full structure: `electron-native-chrome` "Application Menu")
