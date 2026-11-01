## ADDED Requirements

### Requirement: Security page exposes the Trusted Types mode
The Security settings page SHALL offer a Trusted Types mode control with the choices Default (report only, or off when the CSP is off; stores no key), Enforce, Report only and Off, bound to `security.trustedTypes`. The control SHALL save through the panel's Save bar like the other Security fields, and saving a changed value SHALL show the panel's restart-required notice.

#### Scenario: Selecting Report only saves the key
- **WHEN** an operator selects "Report only" on the Security page and saves
- **THEN** the save sends `security.trustedTypes: "report"` and no other changed key on its account
- **AND** the restart-required notice is shown

#### Scenario: Selecting Default clears the key
- **WHEN** `security.trustedTypes` is `report` and an operator selects "Default" and saves
- **THEN** the save sends `security.trustedTypes: null` and the restart-required notice is shown

#### Scenario: Unchanged control sends nothing
- **WHEN** an operator saves the Security page without touching the Trusted Types control
- **THEN** the save sends no `security` key on its account

### Requirement: Trusted Types control is read-only under an environment override
When `GET /api/config` reports a non-null `trustedTypesEnvOverride`, the Security page's Trusted Types control SHALL be read-only and SHALL name `PI_DASHBOARD_TRUSTED_TYPES` and the mode it sets.

#### Scenario: Environment override locks the control
- **WHEN** `GET /api/config` returns `trustedTypesEnvOverride: "report"`
- **THEN** the control is read-only and states "Set by PI_DASHBOARD_TRUSTED_TYPES: Report only"
