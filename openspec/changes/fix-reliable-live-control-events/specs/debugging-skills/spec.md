## ADDED Requirements

### Requirement: Dashboard debug first moves are executable
The repository `debug-dashboard` skill SHALL reference only commands and scripts that exist in the repository or supported installed CLI. Its first moves SHALL cover the active dashboard base URL, `/api/health`, current server logs, and connected sessions without relying on missing scripts.

#### Scenario: Skill command validation
- **WHEN** the debug skill is validated in a clean checkout with dependencies installed
- **THEN** every first-move command SHALL resolve to an existing executable or file
- **AND** the health and session commands SHALL return structured current data when the dashboard is running

#### Scenario: Non-default dashboard port
- **WHEN** the running dashboard uses a port other than 8000
- **THEN** the skill SHALL direct the operator to discover the active base URL before probing health or sessions

### Requirement: Source-switch diagnostics accept supported package entries
The repository source-switch skill SHALL inspect pi settings whose `packages[]` contains both string entries and structured object entries without crashing. String-specific npm and path checks SHALL operate only on string entries and SHALL NOT remove or rewrite structured entries during a read-only status check.

#### Scenario: Status handles mixed string and object entries
- **WHEN** global or project pi settings contain a supported structured `packages[]` entry beside string package sources
- **THEN** the source-switch `status` command SHALL complete and print the source map
- **AND** SHALL NOT raise a string-method type error

#### Scenario: Local switch removes versioned and alternate-checkout sources
- **GIVEN** the target extension appears as a versioned `npm:<name>@<version>` entry and a local path from another checkout
- **WHEN** the source-switch `local` command selects the current checkout
- **THEN** both previous string forms SHALL be removed
- **AND** exactly one current-checkout source SHALL remain

### Requirement: Dashboard bus CLI invocation survives a symlinked install
The repository `pi-dashboard` skill SHALL instruct callers to invoke `dashboard-bus.ts` by its absolute path, because under `npx tsx` a relative `./scripts/dashboard-bus.ts` resolves against the nearest package root rather than the skill directory. The skill SHALL name a supported REST fallback for at least session resume.

#### Scenario: Bus CLI reached through the symlinked package
- **GIVEN** the installed `pi-dashboard` skill is a symlink into `packages/extension`, whose package root has no `scripts/` directory
- **WHEN** the operator follows the skill to run the bus CLI
- **THEN** the documented invocation SHALL resolve the script's absolute path and run without `ERR_MODULE_NOT_FOUND`
- **AND** the skill SHALL document `POST /api/session/<id>/resume` as the supported REST fallback

### Requirement: Full-stack restart guidance is safe under systemd hosting
The repository `implement` skill SHALL warn that `full-rebuild.ts` (which issues `POST /api/restart`) MUST NOT be used against a `systemd`-hosted dashboard, because the unit's default `KillMode=control-group` tears down sibling pi sessions and `Restart=on-failure` does not revive a clean exit. It SHALL direct the operator to restart through the systemd unit and reload bridges separately.

#### Scenario: Systemd-hosted dashboard restart
- **WHEN** the dashboard runs under a `systemd --user` unit
- **THEN** the skill SHALL direct the operator to detect systemd hosting and restart with `systemctl --user restart pi-agent-dashboard.service`
- **AND** SHALL NOT direct `full-rebuild.ts` or a bare `POST /api/restart` for that instance
- **AND** SHALL verify health after the restart and reload bridges as a separate step
