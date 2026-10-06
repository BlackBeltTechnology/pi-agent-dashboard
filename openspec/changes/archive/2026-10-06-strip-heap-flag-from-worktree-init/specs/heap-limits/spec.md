## ADDED Requirements

### Requirement: The dashboard's heap flag SHALL NOT reach worktree-init hook processes

Every process the server spawns to evaluate or run a worktree-init hook — the
gate, the script-flavor run, and the agent-flavor headless pi — SHALL run in an
environment that does NOT carry the dashboard's own old-space flag nor the
provenance marker naming it. The dashboard's own token SHALL be identified by
the provenance marker, NOT by testing for the flag's presence, so an
operator-set heap flag and unrelated `NODE_OPTIONS` entries SHALL be preserved.
An environment explicitly supplied by the caller SHALL be used as given.

#### Scenario: Script run carries no inherited ceiling
- **WHEN** a script-flavor init hook runs while the server runs under a stamped ceiling
- **THEN** the hook process's environment SHALL NOT carry the server's old-space flag
- **AND** SHALL NOT carry the provenance marker variable

#### Scenario: Gate and agent spawn carry no inherited ceiling
- **WHEN** the init gate is evaluated, or an agent-flavor hook is spawned, while the server runs under a stamped ceiling
- **THEN** the spawned process's environment SHALL NOT carry the server's old-space flag

#### Scenario: Unrelated NODE_OPTIONS entries survive
- **WHEN** the server's `NODE_OPTIONS` carries the stamped flag plus an unrelated option
- **THEN** the hook process's `NODE_OPTIONS` SHALL contain only the unrelated option

#### Scenario: NODE_OPTIONS is removed when only the stamp was present
- **WHEN** the server's `NODE_OPTIONS` carries only the stamped flag
- **THEN** the hook process's environment SHALL NOT define `NODE_OPTIONS`

#### Scenario: An operator-set flag survives
- **WHEN** the environment carries an operator-set heap flag not named by the marker
- **THEN** that flag SHALL be preserved in the hook process's environment

#### Scenario: Explicit caller environment is respected
- **WHEN** a caller passes an explicit environment to the hook runner
- **THEN** the hook process SHALL receive that environment unchanged
