## ADDED Requirements

### Requirement: Settings panel loads on demand
The Settings panel module SHALL be loaded the first time a settings view is opened (sidebar button, canonical or legacy settings URL, or deep link), not during the cold landing. While it loads, the settings view SHALL show a loading state inside the panel area; the rest of the shell SHALL stay interactive. Opening settings again in the same page SHALL NOT refetch the module. Values the shell needs outside the panel (e.g. the settings page-id registry and URL mapping) SHALL remain available without loading the panel.

#### Scenario: Deep link to a settings page
- **WHEN** the dashboard is opened directly on a canonical settings URL
- **THEN** the panel module is fetched and the addressed settings page renders once it loads

#### Scenario: Settings module fails to load
- **WHEN** the panel module request fails
- **THEN** the settings view shows an error state with a retry action and the shell keeps working
