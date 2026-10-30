## MODIFIED Requirements

### Requirement: Independent Trusted Types mode
The server SHALL resolve a Trusted Types mode of `off`, `report`, or `enforce` from, in order of precedence:
1. the `PI_DASHBOARD_TRUSTED_TYPES` environment variable;
2. the dashboard config key `security.trustedTypes`;
3. a default.

A source whose value is absent or whitespace-only is not set. The first set source decides. A string value that, trimmed and case-insensitively, equals `off`, `report` or `enforce` resolves to that mode. Any other set value (another string, a number, an object) SHALL resolve to `report`. Every set source with such a value SHALL log one startup warning naming the source without echoing the value, including a source that does not decide. When no source is set, the mode SHALL resolve to `off` if the baseline CSP mode is `off`, and to `report` otherwise. The Trusted Types mode SHALL NOT change the baseline CSP mode, and SHALL NOT remove or alter any directive required by "Baseline policy directives"; it may only add `require-trusted-types-for 'script'`. A development-server page and every dashboard document SHALL state the same mode the server resolves for the same environment and config.

#### Scenario: Default follows an enabled baseline
- **WHEN** neither `PI_DASHBOARD_TRUSTED_TYPES` nor `security.trustedTypes` is set and `PI_DASHBOARD_CSP` is unset, `report` or `enforce`
- **THEN** the Trusted Types mode resolves to `report`

#### Scenario: Default follows a disabled baseline
- **WHEN** neither `PI_DASHBOARD_TRUSTED_TYPES` nor `security.trustedTypes` is set and `PI_DASHBOARD_CSP` is `off`
- **THEN** the Trusted Types mode resolves to `off`

#### Scenario: Existing enforce users are not escalated
- **WHEN** `PI_DASHBOARD_CSP=enforce` and neither environment nor config sets the Trusted Types mode, or either sets it to `report`
- **THEN** Trusted Types is reported, not enforced

#### Scenario: Explicit enforce
- **WHEN** `PI_DASHBOARD_TRUSTED_TYPES=enforce`
- **THEN** the Trusted Types mode resolves to `enforce` whatever the baseline mode

#### Scenario: Explicit off disables Trusted Types
- **WHEN** `PI_DASHBOARD_TRUSTED_TYPES=off` and `PI_DASHBOARD_CSP` is `enforce`
- **THEN** the Trusted Types mode resolves to `off`

#### Scenario: Config sets the mode
- **WHEN** `PI_DASHBOARD_TRUSTED_TYPES` is unset and `security.trustedTypes` is `report`
- **THEN** the Trusted Types mode resolves to `report`

#### Scenario: Environment beats config
- **WHEN** `PI_DASHBOARD_TRUSTED_TYPES=enforce` and `security.trustedTypes` is `off`
- **THEN** the Trusted Types mode resolves to `enforce`

#### Scenario: Recognized value with different case or whitespace
- **WHEN** `PI_DASHBOARD_TRUSTED_TYPES` is ` Report ` (with surrounding spaces)
- **THEN** the Trusted Types mode resolves to `report` and no warning is logged

#### Scenario: Mistyped rollback still relaxes
- **WHEN** `PI_DASHBOARD_TRUSTED_TYPES` is `reprot`
- **THEN** the Trusted Types mode resolves to `report`
- **AND** exactly one startup warning names the environment variable as the source, without the value

#### Scenario: Shadowed config typo is still warned
- **WHEN** `PI_DASHBOARD_TRUSTED_TYPES` is `enforce` and `security.trustedTypes` is `enforced`
- **THEN** the Trusted Types mode resolves to `enforce`
- **AND** exactly one startup warning names the config key as the source

#### Scenario: Non-string config value cannot crash startup
- **WHEN** `security.trustedTypes` is the number `5` or an object and no environment value is set
- **THEN** the server starts, the Trusted Types mode resolves to `report`, and one startup warning names the config key

#### Scenario: Empty value counts as unset
- **WHEN** `PI_DASHBOARD_TRUSTED_TYPES` is the empty string and `security.trustedTypes` is not set
- **THEN** the Trusted Types mode resolves to the default (`report`, or `off` when the baseline CSP mode is `off`)

#### Scenario: Document states the resolved mode
- **WHEN** the dashboard document is served under each resolved Trusted Types mode
- **THEN** the document's stated mode equals the resolved mode
- **AND** under `enforce` an enforcing policy on that document contains `require-trusted-types-for 'script'`, whether as a header of its own (baseline `report`) or appended to the strict enforcing header (baseline `enforce`)
- **AND** under `report` only report-only policies carry the directive

#### Scenario: Development server states the same mode
- **WHEN** the dashboard runs against the development server with neither environment nor config setting the mode and `PI_DASHBOARD_CSP` unset
- **THEN** the served page states the Trusted Types mode `report`
- **AND** with `PI_DASHBOARD_CSP=off` and no Trusted Types setting it states `off`
- **AND** with `security.trustedTypes` set to `enforce` it states `enforce`

## ADDED Requirements

### Requirement: Trusted Types mode is configurable through the config API
The config key `security.trustedTypes` SHALL be writable through `PUT /api/config`. A write SHALL keep every other `security` key. A write of `null` SHALL remove the stored Trusted Types value. A write that changes the stored Trusted Types value, including its removal, SHALL report that a restart is required; a write that repeats the stored value, or removes an absent one, SHALL NOT.

#### Scenario: Changed value requires a restart
- **WHEN** `security.trustedTypes` is unset and `PUT /api/config` sends `{"security":{"trustedTypes":"report"}}`
- **THEN** the config file holds `security.trustedTypes: "report"` and the response reports `restartRequired: true`
- **AND** after a restart the served document states the mode `report`

#### Scenario: Repeated value requires no restart
- **WHEN** `security.trustedTypes` is `report` and `PUT /api/config` sends `{"security":{"trustedTypes":"report"}}`
- **THEN** the response does not report a restart as required on account of the Trusted Types mode

#### Scenario: Null removes the stored value
- **WHEN** `security.trustedTypes` is `report` and `PUT /api/config` sends `{"security":{"trustedTypes":null}}`
- **THEN** the config file has no `security.trustedTypes` key and the response reports `restartRequired: true`
- **AND** the same write when the key is already absent reports no restart on its account

#### Scenario: Sibling security keys survive
- **GIVEN** the config file holds another key under `security`
- **WHEN** `PUT /api/config` sends `{"security":{"trustedTypes":"off"}}`
- **THEN** the other `security` key is unchanged

### Requirement: Config API reports an environment override
`GET /api/config` SHALL include a computed `trustedTypesEnvOverride` field: the recognized `PI_DASHBOARD_TRUSTED_TYPES` value, or `null`. The field SHALL never be written to the config file.

#### Scenario: Environment override is reported, never stored
- **WHEN** the server runs with `PI_DASHBOARD_TRUSTED_TYPES=report` and a client sends back a `GET /api/config` body unchanged with `PUT /api/config`
- **THEN** the `GET` response carried `trustedTypesEnvOverride: "report"`
- **AND** the config file contains no `trustedTypesEnvOverride` key
