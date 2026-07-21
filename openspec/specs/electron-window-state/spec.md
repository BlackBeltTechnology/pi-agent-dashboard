# electron-window-state Specification

## Purpose

Persist the Electron main window's size, position, and maximized state across application restarts, and restore them on launch. Guard against restoring a window to coordinates that are no longer visible on any connected display, falling back to a centered default.

## Requirements

### Requirement: Persist window geometry

The application SHALL persist the main window's geometry — width, height, x/y position, and maximized state — to durable storage whenever the window is moved or resized.

#### Scenario: Save on resize or move

- **WHEN** the user resizes or moves the main window
- **THEN** the current bounds (x, y, width, height) and the maximized flag are written to `~/.pi/dashboard/window-state.json`

#### Scenario: Preserve normal bounds while maximized

- **WHEN** window geometry is saved while the window is maximized
- **THEN** the maximized flag is recorded as true
- **AND** the last known non-maximized bounds are retained as the stored width, height, and position rather than the maximized bounds

#### Scenario: Save failures are non-fatal

- **WHEN** writing the state file fails
- **THEN** the error is ignored and the application continues without interruption

### Requirement: Restore window on launch

The application SHALL restore the persisted geometry when creating the main window, and SHALL fall back to defaults when no valid saved state exists.

#### Scenario: Restore saved geometry

- **WHEN** a valid state file exists at launch
- **THEN** the main window is created with the saved width, height, and position
- **AND** the window is maximized if the saved maximized flag is true

#### Scenario: First-run defaults

- **WHEN** no state file exists
- **THEN** the main window opens at the default size of 1280 by 800 with no explicit position

#### Scenario: Malformed or missing fields

- **WHEN** the state file is unreadable or contains non-numeric width/height values
- **THEN** the default width (1280) and height (800) are used for any missing or invalid field

### Requirement: Recover off-screen windows

The application SHALL clamp restored positions to visible displays, discarding a saved position that would place the window off-screen so it opens centered instead.

#### Scenario: Saved position lands off-screen

- **WHEN** the saved x/y position leaves fewer than 50 pixels wide by 50 pixels tall of the window rectangle intersecting the work area of any connected display
- **THEN** the saved x and y are discarded
- **AND** the window opens at the saved size with a default (centered) position

#### Scenario: Screen information unavailable

- **WHEN** display information cannot be queried during restore
- **THEN** the saved position is assumed on-screen and retained
