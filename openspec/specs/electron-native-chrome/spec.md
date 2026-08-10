# electron-native-chrome Specification

## Purpose

Defines the native OS chrome of the Electron shell: the system tray (icon, ownership-aware server controls, show/quit), the application menu (per-platform structure and item actions), and the routing of link clicks so external URLs open in the OS browser while dashboard navigation stays in-app.

## Requirements

### Requirement: System Tray

The tray SHALL present a platform-appropriate icon with a context menu offering server control, window restoration, and quit, and SHALL reflect the current server ownership.

#### Scenario: Platform icon and tooltip

- **WHEN** the tray is created
- **THEN** on macOS a template image (`trayTemplate.png`) is used; on Windows an `.ico`; on Linux a `.png`
- **AND** the tray tooltip reads "PI Dashboard"

#### Scenario: Server-launch item reflects ownership

- **WHEN** the ownership probe reports `electron` (this app owns the server)
- **THEN** the first menu item is "Restart server" and clicking it launches with force
- **AND** when ownership is `none`, the first item is "Start server" and clicking it launches without force
- **AND** when ownership is `foreign`, the first item is a disabled "Server managed externally" row with no action
- **AND** when ownership is `unknown` (first poll pending or probe error), the server-launch item is omitted

#### Scenario: Show and Quit actions

- **WHEN** the user clicks "Show"
- **THEN** the main window is shown and focused
- **AND** clicking "Quit" invokes the application quit action

#### Scenario: Clicking the tray icon

- **WHEN** the user clicks the tray icon itself
- **THEN** the main window is shown and focused

#### Scenario: Ownership polling

- **WHEN** the tray is created with server hooks
- **THEN** ownership is probed immediately and re-probed every 3 seconds
- **AND** the menu is rebuilt only when the ownership classification changes

#### Scenario: Tray teardown

- **WHEN** the tray is destroyed
- **THEN** the polling interval is cleared and the tray icon is removed

### Requirement: Application Menu

The application menu SHALL provide About, update-check, Doctor, and remote-connection actions, with a full native menu on macOS and a flat top-level structure on Windows and Linux.

#### Scenario: macOS menu structure

- **WHEN** the app menu is set up on macOS
- **THEN** the app-named submenu contains "About <app>", "Check for Updates…", "View Update Log", "Doctor...", "Connect to Remote Dashboard…", "Use Local Dashboard", the hide/hideOthers/unhide roles, and Quit
- **AND** Edit, View (reload, forceReload, toggleDevTools, zoom, togglefullscreen), and Window submenus are present

#### Scenario: Windows and Linux menu structure

- **WHEN** the app menu is set up on Windows or Linux
- **THEN** top-level items are a View submenu (Reload `CmdOrCtrl+R`, Force Reload `CmdOrCtrl+Shift+R`, toggleDevTools, zoom, togglefullscreen), "Check for Updates…", "View Update Log", "About", "Doctor", "Connect to Remote Dashboard…", and "Use Local Dashboard"

#### Scenario: Update-check item hidden in dev

- **WHEN** running an unpackaged dev build
- **THEN** the "Check for Updates…" item is omitted

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

### Requirement: External Link Routing

The shell SHALL keep same-origin dashboard navigation in-app and route external URLs to the OS default browser, without trapping users mid-flow on external identity provider pages.

#### Scenario: Window-open requests go external

- **WHEN** page content requests a new window/tab
- **THEN** the request is denied in-app and its URL is opened in the OS default browser

#### Scenario: Navigation away from the dashboard

- **WHEN** the current page is the dashboard origin and a navigation targets a different origin
- **THEN** the navigation is prevented and the target URL is opened in the OS default browser

#### Scenario: Same-origin navigation stays in-app

- **WHEN** a navigation targets the same origin as the dashboard (including relative paths and fragment-only hrefs)
- **THEN** the navigation is allowed to proceed in-app

#### Scenario: Mid-OAuth provider navigation is allowed

- **WHEN** the current page is an external provider page (not the dashboard origin) and it navigates to another non-dashboard URL
- **THEN** the navigation is allowed to proceed so multi-step login completes in-app

#### Scenario: Unparseable dashboard origin fails closed

- **WHEN** the dashboard origin cannot be parsed
- **THEN** the navigation is cancelled

### Requirement: Close-to-Tray Behavior

The shell SHALL keep the app resident in the tray when the window is closed on macOS rather than quitting.

#### Scenario: Closing the window on macOS

- **WHEN** the user closes the main window on macOS and a quit is not in progress
- **THEN** the close is prevented and the window is hidden, leaving the app available from the tray
