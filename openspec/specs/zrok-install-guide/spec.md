# zrok-install-guide Specification

## Purpose
TBD - restored during archive of change support-zrok-v2. Update Purpose after archive.
## Requirements
### Requirement: Tunnel sidebar button
The sidebar action bar SHALL include a tunnel status button (next to the settings gear) that indicates the current tunnel state.

#### Scenario: Tunnel is active
- **WHEN** the tunnel status is "active"
- **THEN** the button SHALL display a connected indicator and clicking it SHALL show the tunnel URL (copyable)

#### Scenario: Zrok is not installed
- **WHEN** the tunnel status is "unavailable"
- **THEN** clicking the button SHALL navigate to the `/tunnel-setup` installation guide view

#### Scenario: Tunnel is inactive
- **WHEN** the tunnel status is "inactive" (zrok available but tunnel not running)
- **THEN** the button SHALL display a neutral/disconnected indicator

### Requirement: OS-aware installation guide view
The client SHALL render a `/tunnel-setup` route with platform-specific zrok **v2**
installation instructions based on the server's operating system (provided by the
tunnel-status endpoint). Instructions SHALL reflect the v2 binary name per platform.

#### Scenario: macOS server
- **WHEN** the server OS is "darwin"
- **THEN** the guide SHALL show Homebrew installation (`brew install zrok`, which installs the v2 binary as `zrok`)

#### Scenario: Linux server
- **WHEN** the server OS is "linux"
- **THEN** the guide SHALL show the zrok v2 package-repository (recommended) or binary-download install, which provides the `zrok2` command

#### Scenario: Windows server
- **WHEN** the server OS is "win32"
- **THEN** the guide SHALL show downloading the Windows `zrok2` release and adding it to PATH

#### Scenario: Unknown OS
- **WHEN** the server OS cannot be determined
- **THEN** the guide SHALL default to showing Linux instructions with a note to check https://docs.zrok.io

### Requirement: Installation guide content
The installation guide SHALL include steps for installing zrok v2, enrolling (creating an
account and running `zrok enable <token>`, which works headless), and verifying the setup. It
SHALL include a link to the official zrok documentation.

#### Scenario: Guide sections
- **WHEN** the guide is displayed
- **THEN** it SHALL show sections for: Install, Enroll (`zrok enable <token>`), Verify, and a link to https://docs.zrok.io

#### Scenario: Enroll step is non-interactive-safe
- **WHEN** the guide shows the enroll command
- **THEN** it SHALL present `zrok enable <token>` and note the dashboard runs it headless server-side (no TUI/TTY required)

#### Scenario: Back navigation
- **WHEN** the user clicks the back button on the guide
- **THEN** the app SHALL navigate back to the previous view

