## MODIFIED Requirements

### Requirement: Plugin-runtime primitive `useSessionSubagents`

The dashboard-plugin-runtime SHALL export `useSessionSubagents(sessionId: string): ReadonlyMap<string, SubagentStateSnapshot>`. The hook reads the per-session subagent map in `SessionState.subagents` and re-renders subscribers when the map changes for that session id. The map is written only by the subagents plugin's session event reducer slice and `Agent` tool-row finalizer, which the shell registers and applies (`dashboard-plugin-loader` "Plugins register session event reducer slices"); core reducer code no longer writes it.

`SubagentStateSnapshot` is a structurally-typed snapshot mirroring `SubagentState`, whose type now lives in `packages/shared/src/dashboard-plugin/subagent-types.ts`. The runtime types it independently so plugins do not pull in the shell package.

For unknown session ids, and while the subagents plugin is disabled or absent, the hook returns the shared `EMPTY_SUBAGENTS` frozen-Map reference or the map as last written.

The transitional note of the earlier version (subagent state reduced in the shell's central reducer until a follow-up moves it into the plugin) is resolved by `decouple-plugins-from-core`: the reducer slice now lives in the subagents plugin.

#### Scenario: Hook returns the shell-resolved map

- **GIVEN** the shell's `sessionStates.get("sess_1")?.subagents` is `Map([["a1", { id: "a1", status: "running" }]])`
- **AND** App.tsx wires `useSessionSubagents` into `PluginContextProvider`
- **WHEN** a plugin calls `useSessionSubagents("sess_1")`
- **THEN** the call SHALL return that map (or an equivalent structurally-typed snapshot)

#### Scenario: Hook returns empty map for unknown sessions

- **WHEN** a plugin calls `useSessionSubagents("never-existed")`
- **THEN** the hook SHALL return the shared `EMPTY_SUBAGENTS` reference

#### Scenario: Hook re-renders on session state update

- **WHEN** the subagents plugin's slice appends a new entry to `sessionStates.get("sess_1")?.subagents`
- **AND** a plugin component is subscribed via `useSessionSubagents("sess_1")`
- **THEN** the component SHALL re-render with the updated map

#### Scenario: No core writer remains

- **WHEN** the subagents plugin is disabled and a session receives `subagent_started`
- **THEN** `SessionState.subagents` SHALL NOT change, and the event SHALL reach the absent-owner group row
