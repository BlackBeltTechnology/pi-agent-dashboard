# Spec Delta

## ADDED Requirements

### Requirement: A plugin manifest SHALL be able to require pi extension versions

`requires` SHALL accept an optional `piExtensionVersions` map from a pi extension package name to a semver range. The validator SHALL reject an empty name or an invalid range. The requirement probe SHALL compare each range with the installed version and SHALL list every unmet range in `missingRequirements` as `<name> <range>`. `piExtensions` SHALL stay a string array.

#### Scenario: Installed version below the range
- **GIVEN** a plugin requiring `piExtensionVersions: { "@blackbelt-technology/pi-dashboard-subagents": ">=0.7.0" }`
- **WHEN** version 0.6.0 is installed
- **THEN** `missingRequirements` SHALL include `@blackbelt-technology/pi-dashboard-subagents >=0.7.0`

#### Scenario: Invalid range rejected
- **WHEN** a manifest declares `piExtensionVersions: { "x": "not-a-range" }`
- **THEN** the validator SHALL throw `ManifestValidationError`

### Requirement: Finalizers SHALL be found by owned event type

For a session event without a `toolName`, the shell SHALL resolve the tool-row finalizer of the plugin that owns the event's type. At turn settle the shell SHALL call `onTurnSettled` on every registered finalizer. Core SHALL NOT look up a finalizer by a literal tool name.

#### Scenario: Subagent end reaches the subagents finalizer
- **WHEN** `subagent_completed` arrives with the subagents plugin enabled
- **THEN** the subagents plugin's finalizer `onSessionEvent` SHALL receive it, found through ownership of `subagent_*`

## MODIFIED Requirements

### Requirement: Plugins finalize their own tool rows; generic heals stay in core

A client entry MAY export `toolRowFinalizers: { toolName, onToolExecution, onSessionEvent }[]`, registered like reducer slices and gated by the enabled set. Where the reducer finalizes a tool row or touches plugin-owned state on a tool event, it SHALL call that finalizer, and apply its generic heal when none is registered or it declines. Core SHALL keep no writer of any plugin's state slot.

#### Scenario: Plugin finalizes its rows
- **WHEN** the subagents plugin is enabled and `subagent_completed` arrives for a running Agent call
- **THEN** the plugin's finalizer SHALL mark the row completed with the subagent's outcome, and core SHALL contain no subagent-outcome backfill code

#### Scenario: Subagent status writers are plugin hooks
- **WHEN** the subagents plugin is enabled
- **THEN** `onToolExecution` SHALL write `running` from an Agent `tool_execution_update` and `completed`/`failed` from an Agent `tool_execution_end` (including the `/resume` backfill), `onSessionEvent` SHALL write `completed`/`failed` from `subagent_completed|failed`, each under both the `agentId` and `agentSessionId` keys of the plugin's state slot

#### Scenario: Declining finalizer falls back
- **WHEN** the registered finalizer declines a row at turn settle
- **THEN** the shell SHALL apply the generic neutral heal to that row
