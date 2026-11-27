# Spec Delta

## MODIFIED Requirements

### Requirement: Plugin-runtime primitive `useSessionSubagents`

The dashboard-plugin-runtime SHALL export the generic `useSessionPluginState(sessionId: string, pluginId: string): unknown`, which reads the per-session, per-plugin slot of `SessionState` and re-renders subscribers when that slot changes for that session id. The runtime SHALL NOT export a subagent-specific primitive. The subagents plugin SHALL provide `useSessionSubagents(sessionId): ReadonlyMap<string, SubagentState>` itself, on top of `useSessionPluginState`. The slot is written only by the subagents plugin's session event reducer slice and `Agent` tool-row finalizer, which the shell registers and applies (`dashboard-plugin-loader` "Plugins register session event reducer slices"); core reducer code does not write it.

`SubagentState` and every other subagent wire type SHALL live in `packages/subagents-plugin/`. Core packages, including dashboard-plugin-runtime, SHALL NOT type or name it. Requirements in other capabilities that refer to `session.subagents` mean this map, the subagents plugin's view of its slot.

For unknown session ids, and while the subagents plugin is disabled or absent, `useSessionSubagents` returns a shared frozen empty map, or the map as last written.

#### Scenario: Hook returns the shell-resolved map

- **GIVEN** the subagents plugin's slot of session `sess_1` holds `Map([["a1", { id: "a1", status: "running" }]])`
- **WHEN** a plugin component calls `useSessionSubagents("sess_1")`
- **THEN** the call SHALL return that map

#### Scenario: Hook returns empty map for unknown sessions

- **WHEN** a plugin component calls `useSessionSubagents("never-existed")`
- **THEN** the hook SHALL return the shared frozen empty map

#### Scenario: Hook re-renders on session state update

- **WHEN** the subagents plugin's slice adds an entry to the slot of `sess_1`
- **AND** a plugin component is subscribed via `useSessionSubagents("sess_1")`
- **THEN** the component SHALL re-render with the updated map

#### Scenario: No core writer remains

- **WHEN** the subagents plugin is disabled and a session receives `subagent_started`
- **THEN** no `SessionState` slot SHALL change, and the event SHALL reach the absent-owner group row

#### Scenario: Core state has no subagent field

- **WHEN** the core `SessionState` type is inspected
- **THEN** it SHALL have a generic per-plugin slot and no `subagents` field
