# subagents-plugin-state Specification

## Purpose
TBD - created by archiving change add-flow-agent-popout. Update Purpose after archive.

## Requirements

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

### Requirement: SubagentPopoutClaim consumes the primitive

The subagents-plugin SHALL ship a `SubagentPopoutClaim` component that reads subagent state via `useSessionSubagents(params.sessionId)` (NOT via direct access to shell `SessionState`). The claim SHALL render the existing `SubagentPopoutPage` body, wrapped with the standard slot props from `shell-overlay-route`.

#### Scenario: Claim uses the primitive

- **WHEN** `SubagentPopoutClaim` resolves a popout URL with `params.sessionId = "sess_1"` and `params.agentId = "a1"`
- **THEN** it SHALL call `useSessionSubagents("sess_1")`
- **AND** it SHALL look up `subagents.get("a1")` from that map
- **AND** it SHALL render `SubagentPopoutPage` with the resolved data

### Requirement: Transitional documentation

The `useSessionSubagents` primitive SHALL carry inline docs marking it as transitional ("subagent state will move into subagents-plugin in a follow-up change; this primitive is the read bridge until then"). When the migration completes, the primitive remains but its implementation moves from "read shell state" to "read plugin state" — the contract stays the same.

#### Scenario: Inline docs mark transitional status

- **WHEN** a developer inspects `useSessionSubagents`'s JSDoc
- **THEN** the doc SHALL state that the primitive is a transitional read bridge while subagent state lives in shell, and SHALL reference the future plugin-side migration
