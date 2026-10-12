## Purpose

Give the Add-ons page one place that lists everything wrong with installed add-ons, with a count visible from the settings rail.

## ADDED Requirements

### Requirement: The Add-ons page SHALL have an Issues tab

The global Add-ons page SHALL render an **Issues** tab listing:
- plugins that are enabled and either failed to load (`error`) or have missing requirements, each with the error text (copyable), the missing requirements, and a link to the plugin's settings page or an Install action for a missing pi extension (reusing the existing missing-requirement block);
- `packages[]` health problems from `GET /api/packages/health` (stale, missing path, duplicate) rendered by the health panel defined in `add-package-health-cleanup`, when that endpoint exists.

The tab SHALL show the total issue count; the `Add-ons` rail item SHALL show the same count as a warning badge when it is above zero. When there are no issues the tab SHALL say so. When the health endpoint is unavailable (404), the tab SHALL show plugin issues only and SHALL NOT show an error.

#### Scenario: Plugin with a missing path requirement
- **GIVEN** plugin `apple-tools` is enabled and its `${imcpServerPath}` requirement is unresolved
- **WHEN** the Issues tab renders
- **THEN** it SHALL list Apple Tools with the missing requirement and a link to its settings page
- **AND** the rail item SHALL show a count of at least 1

#### Scenario: Health endpoint not available yet
- **GIVEN** `GET /api/packages/health` returns 404
- **WHEN** the Issues tab renders
- **THEN** only plugin issues SHALL be listed and no error SHALL be shown

#### Scenario: No issues
- **WHEN** no plugin issue and no health issue exists
- **THEN** the tab SHALL show a "No issues" message and the rail item SHALL show no count
