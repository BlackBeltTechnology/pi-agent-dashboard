# subagents-plugin-state Specification

## Purpose
TBD - created by archiving change add-flow-agent-popout. Update Purpose after archive.
## Requirements
### Requirement: Plugin-runtime primitive `useSessionSubagents`

The dashboard-plugin-runtime SHALL export `useSessionSubagents(sessionId: string): ReadonlyMap<string, SubagentStateSnapshot>`. The hook reads the per-session subagent map populated by the shell's event reducer and re-renders subscribers when the map changes for that session id.

`SubagentStateSnapshot` is a structurally-typed snapshot mirroring the shell's internal `SubagentState`. The runtime types it independently so plugins do not pull in the shell package.

For unknown session ids, the hook returns the shared `EMPTY_SUBAGENTS` frozen-Map reference.

This primitive is a transitional bridge: subagent state currently lives in the shell's central session-state reducer (`packages/client/src/lib/event-reducer.ts`). A follow-up change will move the reducer into the subagents-plugin (mirror of `pluginize-flows-via-registry`). Until then, the primitive gives the plugin the read access it needs without leaking shell internals.

#### Scenario: Hook returns the shell-resolved map

- **GIVEN** the shell's `sessionStates.get("sess_1")?.subagents` is `Map([["a1", { id: "a1", status: "running" }]])`
- **AND** App.tsx wires `useSessionSubagents` into `PluginContextProvider`
- **WHEN** a plugin calls `useSessionSubagents("sess_1")`
- **THEN** the call SHALL return that map (or an equivalent structurally-typed snapshot)

#### Scenario: Hook returns empty map for unknown sessions

- **WHEN** a plugin calls `useSessionSubagents("never-existed")`
- **THEN** the hook SHALL return the shared `EMPTY_SUBAGENTS` reference

#### Scenario: Hook re-renders on session state update

- **WHEN** the shell appends a new entry to `sessionStates.get("sess_1")?.subagents`
- **AND** a plugin component is subscribed via `useSessionSubagents("sess_1")`
- **THEN** the component SHALL re-render with the updated map

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

