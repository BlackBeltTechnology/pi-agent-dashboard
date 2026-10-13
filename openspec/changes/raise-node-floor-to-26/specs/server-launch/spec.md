## MODIFIED Requirements

### Requirement: Electron-host callers MUST supply an explicit Node binary

When `launchDashboardServer(opts)` is called from `packages/electron/src/lib/**`, the caller SHALL pass an explicit `opts.nodeBin` resolving to a real Node interpreter binary, OR (when no real Node binary satisfying the server engines range is available, and Electron's embedded Node does satisfy it) SHALL set `opts.env.ELECTRON_RUN_AS_NODE = "1"` so the Electron `process.execPath` fallback executes as Node rather than re-launching the GUI. Electron callers SHALL NOT rely on the bare `nodeBin ?? process.execPath` fallback inside `launchDashboardServer`. When neither a qualifying real Node nor a qualifying embedded Node exists, Electron callers SHALL NOT call `launchDashboardServer` at all.

#### Scenario: Bundled-node case sets nodeBin

- **WHEN** an Electron caller invokes `launchDashboardServer` AND the bundled Node binary is present at the path returned by `getBundledNodePath()`
- **THEN** the caller SHALL pass `opts.nodeBin = <bundled-node-path>`
- **AND** the spawned child SHALL be the bundled Node binary, not the Electron GUI binary

#### Scenario: System-node case sets nodeBin

- **WHEN** an Electron caller invokes `launchDashboardServer` AND no bundled Node is available AND the server-spawn runtime resolution returns a system Node satisfying the server engines range
- **THEN** the caller SHALL pass `opts.nodeBin = <system-node-path>`

#### Scenario: execPath fallback requires ELECTRON_RUN_AS_NODE

- **WHEN** an Electron caller invokes `launchDashboardServer` AND neither a bundled nor a qualifying system Node is available AND Electron's embedded Node satisfies the server engines range
- **THEN** the caller SHALL pass `opts.env.ELECTRON_RUN_AS_NODE = "1"`
- **AND** the implicit `process.execPath` fallback in `launchDashboardServer` SHALL execute the Electron binary as Node

#### Scenario: Repo-lint pins the Electron-caller contract

- **WHEN** the repo-lint test `no-electron-execpath-spawn` scans `packages/electron/src/lib/**/*.ts`
- **THEN** every call expression matching `launchDashboardServer(` SHALL either include a `nodeBin:` property in the options literal OR include `ELECTRON_RUN_AS_NODE` in the env literal passed to the same call
- **AND** the lint allowlist for `process.execPath` references inside Electron lib code SHALL contain exactly `pick-node.ts`

#### Scenario: Non-Electron callers unaffected

- **WHEN** `launchDashboardServer` is called from the bridge extension, the standalone CLI, or the restart-helper
- **THEN** the requirement does NOT apply
- **AND** the bridge extension SHALL pass the `nodeBin` returned by server-spawn runtime resolution (pi's own Node may be below the server floor)
- **AND** the standalone CLI and the restart-helper MAY continue to omit `opts.nodeBin` and rely on the `process.execPath` default, because they already run inside a server-floor-checked Node

#### Scenario: No qualifying runtime means no launch call

- **WHEN** an Electron caller has no bundled Node, no qualifying system Node, and Electron's embedded Node is below the server engines range
- **THEN** the caller SHALL NOT invoke `launchDashboardServer`
