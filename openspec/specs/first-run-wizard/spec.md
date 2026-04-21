## ADDED Requirements

### Requirement: First-run detection
The Electron app SHALL detect first-run state by checking whether a valid installation mode has been completed previously.

#### Scenario: Fresh machine — nothing configured
- **WHEN** the app launches and `~/.pi-dashboard/mode.json` does not exist
- **THEN** the first-run wizard SHALL be displayed

#### Scenario: Previous setup completed
- **WHEN** the app launches and `~/.pi-dashboard/mode.json` exists with a valid mode
- **THEN** the wizard SHALL be skipped and the dashboard loads directly

### Requirement: Installation mode selection
The wizard SHALL present two installation modes as the first step.

#### Scenario: Standalone mode selected
- **WHEN** the user selects "Set up everything for me"
- **THEN** the wizard SHALL proceed to install pi, the dashboard package, openspec, and tsx into `~/.pi-dashboard/node_modules/`

#### Scenario: Power user mode selected
- **WHEN** the user selects "Use my existing pi installation"
- **THEN** the wizard SHALL verify pi and openspec are on PATH and the dashboard bridge extension is registered with pi

### Requirement: Standalone mode installation
In standalone mode, the wizard SHALL install all required tools into the managed location.

#### Scenario: Full standalone install
- **WHEN** standalone mode is active
- **THEN** the wizard SHALL install `@mariozechner/pi-coding-agent`, `@blackbelt-technology/pi-dashboard`, `@fission-ai/openspec`, and `tsx` into `~/.pi-dashboard/node_modules/`
- **AND** show progress per dependency (checking → installing → installed / failed)

#### Scenario: Standalone install uses bundled Node when no system Node
- **WHEN** standalone mode is active and no system Node.js is detected
- **THEN** the installer SHALL use the bundled Node.js and npm from extraResources

#### Scenario: Installation failure with retry
- **WHEN** a dependency installation fails
- **THEN** the wizard SHALL show the error message and a "Retry" button

### Requirement: Power user mode verification
In power user mode, the wizard SHALL verify the existing installation and guide the user to fix any gaps.

#### Scenario: All tools present
- **WHEN** pi, openspec, and the dashboard package are all detected
- **THEN** the wizard SHALL show green checkmarks and proceed to the API key step

#### Scenario: Dashboard bridge not registered
- **WHEN** pi is detected but the dashboard package is not installed/registered
- **THEN** the wizard SHALL offer to install it via `npm install -g @blackbelt-technology/pi-dashboard`

#### Scenario: pi not found in power user mode
- **WHEN** pi is not detected on PATH in power user mode
- **THEN** the wizard SHALL show an error with instructions to install pi or switch to standalone mode

### Requirement: API key configuration step
The wizard SHALL prompt for an LLM API key and write it to pi's settings file.

#### Scenario: User enters API key
- **WHEN** the user enters an API key and clicks "Save"
- **THEN** the wizard SHALL write the key to `~/.pi/agent/settings.json` in the appropriate provider field

#### Scenario: User skips API key
- **WHEN** the user clicks "Skip" on the API key step
- **THEN** the wizard SHALL proceed (pi sessions will fail until configured, but the dashboard itself works)

#### Scenario: API key already configured
- **WHEN** `~/.pi/agent/settings.json` already contains an API key
- **THEN** the API key step SHALL be pre-filled and show "Already configured"

### Requirement: Mode persistence
The wizard SHALL persist the chosen mode to `~/.pi-dashboard/mode.json` on completion.

#### Scenario: Mode saved on completion
- **WHEN** the wizard finishes successfully
- **THEN** it SHALL write `{ "mode": "standalone" | "power-user", "completedAt": "<ISO timestamp>" }` to `~/.pi-dashboard/mode.json`

### Requirement: Bundled status indication
The first-run wizard SHALL visually distinguish recommended extensions that were activated from the bundled payload from those installed dynamically from npm/git.

#### Scenario: Bundled-installed entry
- **WHEN** a recommended extension's install progress reports `output: "Already installed (bundled)"` or was processed by `installBundledExtensions()`
- **THEN** the wizard row SHALL render a "Bundled ✓" badge next to the step name

#### Scenario: System-installed entry
- **WHEN** an entry was skipped because it is already present on the user's system (not from bundle)
- **THEN** the wizard row SHALL render an "Installed" badge, distinct from the "Bundled ✓" badge

#### Scenario: Dynamically-installed entry
- **WHEN** an entry is installed via `installRecommendedExtensions()` during the wizard
- **THEN** the wizard row SHALL show normal running/done progress with no bundled badge
