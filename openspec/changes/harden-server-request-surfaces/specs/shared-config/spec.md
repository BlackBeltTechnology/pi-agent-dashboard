## REMOVED Requirements

### Requirement: `hostGate.mode` config field
**Reason**: The clause collapsed "absent" and "unrecognised" into a single `report` result, which is exactly the behaviour this change splits. Its two scenarios encode the old default in their names, so the requirement is re-stated under a name that does not.
**Migration**: Operators who need the old behaviour set `hostGate.mode: "report"` explicitly in `config.json` (or `PI_DASHBOARD_HOST_GATE=report`). Every other clause — the optional shape, `ensureConfig()` not seeding the key, `writeConfigPartial` writing the object whole — carries over unchanged into "`hostGate.mode` config field and its resolved default".

## ADDED Requirements

### Requirement: `hostGate.mode` config field and its resolved default
The config loader SHALL support an optional `hostGate: { mode: "report" | "enforce" }`. An **absent** object or absent `mode` SHALL load as `{ mode: "enforce" }`. An **unrecognised** `mode` value SHALL load as `{ mode: "report" }`, so that a typo cannot silently refuse an operator's requests. A config file that is **missing, empty, or unparseable** SHALL also load as `{ mode: "enforce" }` — a config the loader cannot read is not evidence that the operator opted out, so these paths SHALL fail closed rather than inheriting a report-only default. The key SHALL NOT be seeded by `ensureConfig()`. `writeConfigPartial` SHALL accept `hostGate` and write the object whole (it has one key; no deep-merge).

#### Scenario: Absent defaults to enforce
- **WHEN** `config.json` has no `hostGate` key
- **THEN** the loaded config SHALL expose `hostGate.mode` as `"enforce"`

#### Scenario: A missing, empty or unparseable config file still defaults to enforce
- **WHEN** no `config.json` exists, or it is empty, or it holds unparseable JSON
- **THEN** the loaded config SHALL expose `hostGate.mode` as `"enforce"` in each case
- **AND** it SHALL NOT expose `"report"`

#### Scenario: Unrecognised mode falls back to report
- **WHEN** `hostGate.mode` is `"yes"`
- **THEN** the loaded value SHALL be `"report"`
- **AND** the loaded value SHALL NOT be `"enforce"`

#### Scenario: Write persists enforce
- **WHEN** `PUT /api/config` carries `{ hostGate: { mode: "enforce" } }`
- **THEN** the written file SHALL hold `hostGate.mode: "enforce"` and every other key SHALL be unchanged

#### Scenario: Explicit report survives a load round-trip
- **WHEN** `config.json` holds `hostGate.mode: "report"`
- **THEN** the loaded value SHALL be `"report"` (the enforce default SHALL apply only to an absent value)

#### Scenario: Unrelated config write does not seed the key
- **WHEN** a runtime writer updates an unrelated key while `config.json` has no `hostGate` key
- **THEN** the written file SHALL still have no `hostGate` key
