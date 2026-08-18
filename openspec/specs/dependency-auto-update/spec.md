# dependency-auto-update Specification

## Purpose

Keeps the dashboard's pi packages current without the user having to watch for releases: a periodic outdated check, a notification when updates exist, and an execution path that performs the update on request.

## Requirements

### Requirement: Periodic outdated check
The Electron app SHALL check for newer versions of pi and openspec on launch and every 24 hours while running.

#### Scenario: Check on launch
- **WHEN** the Electron app starts and dependencies are installed
- **THEN** it SHALL run an outdated check for `@mariozechner/pi-coding-agent` and `@fission-ai/openspec` within 30 seconds of launch

#### Scenario: Check every 24 hours
- **WHEN** 24 hours have elapsed since the last check
- **THEN** a new outdated check SHALL be triggered

#### Scenario: No network — check silently fails
- **WHEN** the outdated check fails due to network error
- **THEN** the failure SHALL be logged but no user notification SHALL be shown

### Requirement: Update notification
When newer versions are available, the dashboard SHALL show a non-blocking notification with an "Update" button.

#### Scenario: Newer pi version available
- **WHEN** the outdated check finds a newer pi version
- **THEN** a notification SHALL appear in the dashboard showing the current and available versions with an "Update" button

#### Scenario: User clicks Update
- **WHEN** the user clicks the "Update" button
- **THEN** the app SHALL run `npm install <package>@latest` using the same Node/npm that installed the original
- **AND** show progress and success/failure status

#### Scenario: User dismisses notification
- **WHEN** the user dismisses the update notification
- **THEN** the notification SHALL not reappear until the next 24-hour check cycle

### Requirement: Update execution
Updates SHALL be performed using the same npm and install location that originally installed the dependency.

#### Scenario: System-installed pi updated via system npm
- **WHEN** pi was detected on system PATH (not managed install)
- **THEN** the update SHALL run `npm install -g @mariozechner/pi-coding-agent@latest` using system npm

#### Scenario: Managed-install pi updated via managed npm
- **WHEN** pi was installed in `~/.pi-dashboard/node_modules/`
- **THEN** the update SHALL run `npm install @mariozechner/pi-coding-agent@latest` in `~/.pi-dashboard/`
