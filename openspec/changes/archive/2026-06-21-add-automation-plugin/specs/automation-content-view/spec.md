# automation-content-view

## ADDED Requirements

### Requirement: Automation UI contributed via shell slots

The plugin SHALL contribute its UI exclusively through existing dashboard slots and SHALL NOT add Automation-specific conditional rendering to core shell files. It SHALL claim `sidebar-folder-section` (folder nav entry), `command-route` (board + run list), `shell-overlay-route` (run monitor), `session-card-badge` (optional running indicator, predicate-gated), and `settings-section` (scopes + retention + default run visibility config).

#### Scenario: Folder nav entry rendered via slot

- **WHEN** a folder has N automations
- **THEN** the sidebar SHALL show an "Automations (N) →" entry rendered by the plugin's `sidebar-folder-section` claim, with no core shell branch added.

#### Scenario: No core branch for automation

- **WHEN** the automation plugin is disabled
- **THEN** the shell SHALL render with no Automation nav entry, board route, badge, or settings section, and no errors.

### Requirement: Create Automation entry point

The dashboard SHALL present a "Create Automation" action alongside "New Session". Activating it SHALL open an editor for the trigger, action (prompt or skill), model (direct via `ModelSelector` or `@role` via role dropdown), scope (`folder` | `global`), `mode`, and `concurrency`, and SHALL write `automation.yaml` (and `prompt.md` for prompt actions) to the chosen scope.

#### Scenario: Create writes to chosen scope

- **WHEN** a user creates an automation with scope `global`
- **THEN** `~/.pi/automation/<name>/automation.yaml` SHALL be written and the automation SHALL appear with scope `global`.

#### Scenario: Prompt action writes prompt.md

- **WHEN** a user creates a `prompt` automation
- **THEN** a `prompt.md` SHALL be written next to `automation.yaml` and referenced by `action.prompt`.

### Requirement: Default run visibility setting

The automation settings section SHALL expose a default run visibility (`hidden` | `shown`, default `hidden`) applied to automations that do not declare their own `visibility`. The create/edit editor SHALL allow setting a per-automation `visibility` override.

#### Scenario: Settings default applied when automation omits visibility

- **WHEN** the settings default is `shown` and an automation omits `visibility`
- **THEN** that automation's runs SHALL appear on the board.

#### Scenario: Editor sets per-automation override

- **WHEN** a user sets `visibility: hidden` for one automation in the editor
- **THEN** `automation.yaml` SHALL record `visibility: hidden` and that automation's runs SHALL stay off the board regardless of the settings default.

### Requirement: Triage run list

The Automation view SHALL list runs with status (`running` | `done` | `error`) and surface findings. Auto-archived empty runs SHALL be filterable out of the default (unread) view.

#### Scenario: Findings surfaced in Triage

- **WHEN** a run completes with findings
- **THEN** the run SHALL appear in Triage as unread with its `result.md` viewable.

#### Scenario: Empty runs hidden by default

- **WHEN** the user views the default Triage list
- **THEN** auto-archived empty runs SHALL NOT appear unless the user switches to the all-runs filter.
