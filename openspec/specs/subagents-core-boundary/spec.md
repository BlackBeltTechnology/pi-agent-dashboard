# subagents-core-boundary Specification

## Purpose
Keeps every subagent contract (wire types, event names, state, buffering, store rules, heals, delivery keys, config) inside the subagents plugin, makes a reintroduction into core fail the convention check, and sets the minimum producer version.

## Requirements

### Requirement: Core SHALL name no subagent contract identifier

Production sources under `packages/extension/src`, `packages/server/src`, `packages/shared/src`, `packages/client/src` and `packages/dashboard-plugin-runtime/src` SHALL NOT contain a subagent event type, bus channel, message type, state field, config key or wire type name. Tests, generated files and i18n catalogs are exempt. Role names, settings labels and comments that only say "subagent" are not contract identifiers.

#### Scenario: Core names no subagent event type
- **WHEN** core production sources are searched for `subagent_created`, `subagents:`, `SubagentState`, `subagentTickThrottle` or `SUBAGENT_EVENT_MAP`
- **THEN** no match SHALL be found

#### Scenario: Plugin owns the contract
- **WHEN** the subagent wire types and event names are searched for
- **THEN** they SHALL be found under `packages/subagents-plugin/`

### Requirement: Cross-plugin registries SHALL be exempt only through a reasoned allowlist

A checked-in allowlist SHALL list each exempt core occurrence as a file, a pattern and a reason. Entries SHALL be limited to registries that list every plugin's entries, such as the route-tier table and shipped event-group patterns.

#### Scenario: Route-tier entry is allowlisted
- **GIVEN** the allowlist names `packages/shared/src/route-tiers.ts` with pattern `/api/plugins/subagents/` and a reason
- **WHEN** the boundary check runs
- **THEN** that occurrence SHALL pass

### Requirement: The boundary check SHALL fail on a reintroduced contract identifier

A tree-wide boundary check, run by `npm test`, SHALL fail when a core production source line matches its case-insensitive denylist: any `subagent_` event or message type, any `subagents:` channel, the subagent state, timeline, details, throttle and heap type or config families, the former event map, the former runtime primitives, and `.subagents` state access. It SHALL name the file and line, and SHALL NOT fail on the plain word "subagent".

#### Scenario: Reintroduced event type fails
- **GIVEN** a commit adds `case "subagent_completed":` to `packages/server/src/pairing/browser-gateway.ts`
- **WHEN** the boundary check runs
- **THEN** it SHALL fail and name that file and line

#### Scenario: Role label passes
- **GIVEN** a core settings label reading "Max parallel subagents"
- **WHEN** the boundary check runs
- **THEN** it SHALL pass

### Requirement: The plugin SHALL require producer 0.7.0 or later

The subagents plugin SHALL declare `pi-dashboard-subagents` `>=0.7.0`. When the installed producer is older, the plugin status SHALL list the version as a missing requirement and the dock SHALL show a one-line update notice instead of rows.

#### Scenario: Producer below the floor
- **GIVEN** an installed `pi-dashboard-subagents` 0.6.0
- **WHEN** the plugin status is read and a subagent runs
- **THEN** `missingRequirements` SHALL name `@blackbelt-technology/pi-dashboard-subagents >=0.7.0` and the dock SHALL show the update notice
