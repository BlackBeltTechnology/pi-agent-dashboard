## MODIFIED Requirements

### Requirement: Periodic outdated check
The Electron app SHALL check for newer versions of pi and openspec on launch and every 24 hours while running.

#### Scenario: Check on launch
- **WHEN** the Electron app starts and dependencies are installed
- **THEN** it SHALL run an outdated check for `@earendil-works/pi-coding-agent` and `@fission-ai/openspec` within 30 seconds of launch

#### Scenario: Check every 24 hours
- **WHEN** 24 hours have elapsed since the last check
- **THEN** a new outdated check SHALL be triggered

#### Scenario: Legacy fork is never checked
- **WHEN** `@mariozechner/pi-coding-agent` is installed alongside `@earendil-works/pi-coding-agent`
- **THEN** the outdated check SHALL NOT query or report `@mariozechner/pi-coding-agent`

#### Scenario: No network — check silently fails
- **WHEN** the outdated check fails due to network error
- **THEN** the failure SHALL be logged but no user notification SHALL be shown

### Requirement: Update execution
Updates SHALL be performed using the same npm and install location that originally installed the dependency.

#### Scenario: System-installed pi updated via system npm
- **WHEN** pi was detected on system PATH (not managed install)
- **THEN** the update SHALL run `npm install -g @earendil-works/pi-coding-agent@latest` using system npm

#### Scenario: Managed-install pi updated via managed npm
- **WHEN** pi was installed in `~/.pi-dashboard/node_modules/`
- **THEN** the update SHALL run `npm install @earendil-works/pi-coding-agent@latest` in `~/.pi-dashboard/`
