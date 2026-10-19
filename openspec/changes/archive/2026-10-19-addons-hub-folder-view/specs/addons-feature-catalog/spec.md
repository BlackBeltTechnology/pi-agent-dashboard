## MODIFIED Requirements

### Requirement: The Installed tab SHALL render one row per feature

The Add-ons Installed tab SHALL render one row per catalog feature with: name, description, origin badge, part chips (dashboard UI, extension, bridge, skills, prompts, themes with counts), version and update badge per package part, a single on/off control for toggleable features, styled as a switch with checkbox semantics (`role="checkbox"`) so a `partial` feature exposes `aria-checked="mixed"` and a visible "partly on" label, and an expander. The expander SHALL show a "For the AI agent (pi)" panel (packages, published variant, bridge marked managed, contents, delivered by) and a "For this dashboard" panel (plugin id and status, missing requirements with the existing install pill, delivered by, depends on, required by) plus actions per package part (Update, Reset to published version per `pi-core-version-ui`, Move scope, Uninstall) and per feature (Settings, README). A package part is uninstallable unless it is a `core:*` part or a `dashboardManaged` bridge; a dashboard plugin without a package part has no Uninstall. When the off confirmation lists `keptOn` packages it SHALL name the requiring features with a link to each row. The package health panel SHALL NOT render above the feature list; it renders inside the Add-ons Issues tab (`addons-issues`). Turning a switch off on a feature with a pi part or a cascade SHALL first request a dry run and show a confirmation naming what stops (dashboard UI and/or the AI-agent part), cascaded features, packages kept on, requiring plugins, and folders that keep loading. After a successful toggle the existing session-reload prompt SHALL be offered.

#### Scenario: Goal row
- **WHEN** the Installed tab renders feature `plugin:goal`
- **THEN** one row SHALL show the `dashboard UI · ext by @ricoyudog` badge and chips `dashboard UI`, `bridge`, `extension`

#### Scenario: Confirm before a combined off
- **WHEN** the user switches off `plugin:goal`
- **THEN** a confirmation SHALL say that both the dashboard UI and the AI-agent part stop
- **AND** nothing SHALL be written until the user confirms

#### Scenario: Partial feature
- **GIVEN** plugin `goal` was disabled from the Plugins index and its package entry is unfiltered
- **WHEN** the Installed tab renders `plugin:goal`
- **THEN** its control SHALL expose `aria-checked="mixed"`
- **AND** activating it SHALL open the off confirmation
