## ADDED Requirements

### Requirement: Settings panel exposes spawn-register timeout
The Settings panel (`packages/client/src/components/SettingsPanel.tsx`) SHALL render a numeric input field for `spawnRegisterTimeoutMs` under the General → Sessions group (or nearest equivalent group containing other spawn-related fields). The field SHALL be labelled "Spawn register timeout (ms)" with helper text "How long to wait for a spawned pi session to connect before showing a warning. Default 30000 (30s). Range 5000–120000."

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
