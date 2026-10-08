## ADDED Requirements

### Requirement: Blackhole model slots MAY follow a model role

When the roles plugin is installed, the base-model control and every chain entry (`model`, `observerModel`/`reflectorModel`/`dropperModel` and each `*FallbackModels` entry) SHALL offer the model-selector Role tab. Saving a role-bound slot SHALL write the role's current concrete `ModelRef` (`provider`, `id`, and `thinking` from the resolved level) to `pi-blackhole-config.json` and record a role binding for that slot, so later role or preset changes re-project the slot. `pi-blackhole-config.json` SHALL only ever contain concrete `ModelRef` values — never a role ref. Per-entry `cooldownHours` and `contextWindow` SHALL be preserved across re-projection.

#### Scenario: Role-bound observer is written concretely
- **GIVEN** `fast` resolves to `anthropic/claude-haiku-4-5:low`
- **WHEN** the user sets the observer primary to `@fast` and saves
- **THEN** `observerModel` SHALL be written as `{provider:"anthropic", id:"claude-haiku-4-5", thinking:"low"}`
- **AND** the slot SHALL be recorded as bound to `@fast`

#### Scenario: Preset change rewrites only bound slots
- **GIVEN** `observerModel` is bound to `@fast` and `reflectorModel` is a direct model
- **WHEN** the active preset reassigns `fast`
- **THEN** `observerModel` SHALL be rewritten with the new concrete model
- **AND** `reflectorModel` and all unmanaged keys SHALL be left untouched

#### Scenario: Binding follows a reordered chain entry
- **GIVEN** `observerFallbackModels[0]` is bound to `@fast` and `observerFallbackModels[1]` is direct
- **WHEN** the user swaps the two entries and saves
- **THEN** the binding SHALL follow the entry to `observerFallbackModels[1]` AND `observerFallbackModels[0]` SHALL be unbound

#### Scenario: Removing an entry removes its binding
- **WHEN** a role-bound chain entry is removed and saved
- **THEN** its binding SHALL be removed and no later projection SHALL write to that position

#### Scenario: Slot shows binding status
- **WHEN** a role-bound slot is `dangling` or `detached`
- **THEN** the slot SHALL display that status with the role name and the concrete value currently in the file

#### Scenario: Binding an unassigned role is rejected
- **WHEN** the user sets a slot to a role that has no assignment and saves
- **THEN** the save SHALL be rejected with an error naming the role
- **AND** `pi-blackhole-config.json` and existing bindings SHALL be unchanged

#### Scenario: Roles plugin absent while bindings exist
- **GIVEN** slots were bound while the roles plugin was installed and the plugin is then disabled or uninstalled
- **WHEN** the blackhole settings render and the user saves
- **THEN** slots SHALL show their concrete values without a Role tab
- **AND** the save SHALL write concrete values only and SHALL NOT alter the stored bindings
- **AND** when the roles plugin returns, any slot whose file value no longer matches its last projected value SHALL be `detached`, not overwritten

#### Scenario: Cooldown survives re-projection
- **GIVEN** a role-bound fallback entry has `cooldownHours: 2`
- **WHEN** its role is reassigned
- **THEN** the re-projected entry SHALL still carry `cooldownHours: 2`
