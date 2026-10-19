## MODIFIED Requirements

### Requirement: Settings UI SHALL surface health issues in the Packages section

The Settings view SHALL fetch `/api/packages/health` through the shared Add-ons issue-count source (on Settings mount and after a cleanup Apply) and SHALL render the `PackageHealthPanel` inside the Add-ons **Issues** tab (see `addons-issues`) whenever the summary contains any non-`ok` entries; the panel SHALL NOT render above the installed list. The non-`ok` entry count SHALL contribute to the Issues tab count, which replaces the former `Issues (N)` section-header badge.

#### Scenario: No issues renders nothing

- **GIVEN** the health response has only `ok` entries
- **WHEN** the user opens the Add-ons page
- **THEN** no health panel SHALL render and the health entries SHALL add nothing to the Issues tab count

#### Scenario: Issues render an expanded panel with badge

- **GIVEN** the health response contains stale, missing, or duplicate entries
- **WHEN** the user first opens the Issues tab in a browser session
- **THEN** the Issues tab count SHALL include N, the non-ok entry count
- **AND** the `PackageHealthPanel` SHALL render auto-expanded inside the Issues tab
- **AND** sub-sections SHALL render only for non-empty status groups

#### Scenario: Missing-path duplicate members are pre-checked for drop

- **GIVEN** a duplicate group of 4 members where 2 have `status === "missing-path"`
- **WHEN** the panel renders that group
- **THEN** those 2 members SHALL have their drop-checkbox pre-checked
- **AND** the other 2 SHALL be unchecked

#### Scenario: Apply triggers cleanup + refresh + restart banner

- **GIVEN** at least one row is checked for drop
- **WHEN** the user clicks Apply
- **THEN** the client SHALL issue exactly one `POST /api/packages/cleanup` with the union of checked sources
- **AND** on success SHALL re-fetch `/api/packages/installed`
- **AND** SHALL display a "Restart required" banner
- **AND** the Apply button SHALL be disabled while the request is in flight
