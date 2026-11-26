## MODIFIED Requirements

### Requirement: Settings panel exposes spawn-register timeout
The Settings panel (`packages/client/src/components/settings/SettingsPanel.tsx`) SHALL render a numeric input field for `spawnRegisterTimeoutMs` under the Sessions group (or nearest equivalent group containing other spawn-related fields). The field SHALL be labelled "+Session register timeout" with a `ms` unit badge (the label key `session.sessionRegisterTimeoutMs`, unchanged; it already matches the shipped UI and the `ui-terminology` wording) and helper text (key `common.howLongToWaitForA`, unchanged key) "How long to wait for a new pi session to connect before reporting a failure and terminating the new pi process. Default 30000 (30s). Range 5000–120000."

The input SHALL accept integers in the closed range `[5000, 120000]`. Out-of-range or non-numeric inputs SHALL be flagged as invalid (existing settings-form invalidation pattern) and SHALL prevent save until corrected.

On save, the value SHALL be persisted via the existing `POST /api/config` config-write path. The watchdog SHALL pick up the new value on the next spawn (read-on-arm — no server restart required).

#### Scenario: field rendered with current config value
- **WHEN** the Settings panel mounts with config `{ spawnRegisterTimeoutMs: 45000 }`
- **THEN** the input SHALL display the value `45000`

#### Scenario: in-range value saves
- **WHEN** the user enters `60000` and clicks Save
- **THEN** `POST /api/config` SHALL be called with `{ spawnRegisterTimeoutMs: 60000 }` (alongside any other dirty fields)

#### Scenario: out-of-range input rejected
- **WHEN** the user enters `1000` (below minimum)
- **THEN** the field SHALL be flagged as invalid with helper text indicating the valid range
- **AND** Save SHALL remain disabled or refuse to submit the field

#### Scenario: non-numeric input rejected
- **WHEN** the user enters `"abc"`
- **THEN** the field SHALL be flagged as invalid and Save SHALL be blocked

#### Scenario: helper text mentions default and range
- **WHEN** the field is rendered
- **THEN** the helper text SHALL include both the default value (30000 / 30s) and the valid range (5000–120000)

#### Scenario: helper text states the process is terminated
- **WHEN** the field is rendered
- **THEN** the helper text SHALL state that the new pi process is terminated on timeout and SHALL NOT describe the timeout as only a warning
- **AND** the English helper text SHALL contain no form of the word "spawn" (`ui-terminology`)
