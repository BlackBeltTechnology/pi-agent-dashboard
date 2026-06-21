# automation-content-view — delta

## MODIFIED Requirements

### Requirement: Automation UI contributed via shell slots

The plugin SHALL contribute its UI exclusively through existing dashboard slots and SHALL NOT add Automation-specific conditional rendering to core shell files. It SHALL claim `sidebar-folder-section` (folder nav entry), `shell-overlay-route` (full-page board + run monitor), `session-card-badge` (optional running indicator, predicate-gated), and `settings-section` (scopes + retention + default run visibility config). The board SHALL NOT use the `command-route` slot, whose consumer is not mounted in the shell.

#### Scenario: Folder nav entry rendered via slot

- **WHEN** a folder has N automations
- **THEN** the sidebar SHALL show an "Automations (N) →" entry rendered by the plugin's `sidebar-folder-section` claim, with no core shell branch added.

#### Scenario: Folder nav entry visually mirrors the OpenSpec folder section

- **WHEN** the Automations row and the OpenSpec row render in the same folder card
- **THEN** the Automations row SHALL use the same header anatomy as the OpenSpec row: a 10px uppercase clickable title with count and `→`, a refresh control, and right-aligned action chip(s).

#### Scenario: Board opens via shell-overlay-route

- **WHEN** a user activates the folder "Automations (N) →" entry
- **THEN** the shell SHALL navigate to `/folder/:encodedCwd/automations` and render the board through the plugin's `shell-overlay-route` claim, scoped to the decoded cwd.

#### Scenario: No core branch for automation

- **WHEN** the automation plugin is disabled
- **THEN** the shell SHALL render with no Automation nav entry, board route, badge, or settings section, and no errors.

### Requirement: Create Automation entry point

The dashboard SHALL present a "Create Automation" action reachable from the folder Automations entry. The folder Automations row SHALL expose a "+ New" action that opens the create editor directly, and the board SHALL also expose a "Create Automation" action. Activating either SHALL open an editor for the trigger, action (prompt or skill), model (direct via `ModelSelector` or `@role` via role dropdown), scope (`folder` | `global`), `mode`, and `concurrency`, and SHALL write `automation.yaml` (and `prompt.md` for prompt actions) to the chosen scope.

#### Scenario: Create from sidebar without opening board

- **WHEN** a user activates the "+ New" action on the folder Automations row
- **THEN** the create editor SHALL open without first navigating to the board.

#### Scenario: Create writes to chosen scope

- **WHEN** a user creates an automation with scope `global`
- **THEN** `~/.pi/automation/<name>/automation.yaml` SHALL be written and the automation SHALL appear with scope `global`.

#### Scenario: Prompt action writes prompt.md

- **WHEN** a user creates a `prompt` automation
- **THEN** a `prompt.md` SHALL be written next to `automation.yaml` and referenced by `action.prompt`.
