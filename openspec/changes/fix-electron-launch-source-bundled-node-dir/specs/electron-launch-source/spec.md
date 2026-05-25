# electron-launch-source — delta

## ADDED Requirements

### Requirement: spawnFromSource passes bundled-Node dir via getBundledNodeDir()

`packages/electron/src/lib/launch-source.ts::spawnFromSource` SHALL obtain the bundled-Node directory it passes to `pickNodeForServer({ bundledNodeDir, … })` by calling `getBundledNodeDir()` from `bundled-node.ts`. It SHALL NOT compute the directory by chaining `path.dirname` on the result of `getBundledNodePath()`.

#### Scenario: Windows resources layout resolves to bundled Node

- **WHEN** the Electron app spawns the server on Windows AND the bundled-Node binary exists at `<resources>\node\node.exe`
- **THEN** `spawnFromSource` SHALL pass `<resources>\node` as `bundledNodeDir` to `pickNodeForServer`
- **AND** `pickNodeForServer` SHALL return `{ kind: "bundled" }` with `nodeBin = <resources>\node\node.exe`
- **AND** the spawned server SHALL run under real Node (no `ELECTRON_RUN_AS_NODE=1`)
- **AND** the server log SHALL NOT contain the line `Bundled Node not found — falling back to process.execPath`

#### Scenario: POSIX resources layout resolves to bundled Node

- **WHEN** the Electron app spawns the server on macOS/Linux AND the bundled-Node binary exists at `<resources>/node/bin/node`
- **THEN** `spawnFromSource` SHALL pass `<resources>/node` as `bundledNodeDir` to `pickNodeForServer`
- **AND** `pickNodeForServer` SHALL return `{ kind: "bundled" }` with `nodeBin = <resources>/node/bin/node`

#### Scenario: Lint forbids dirname-arithmetic on bundled-Node path

- **WHEN** repository linters run (vitest `no-*` rule files under `packages/electron/src/__tests__/`)
- **THEN** any source file under `packages/electron/src/` containing `path.dirname(` chained around `getBundledNodePath()` SHALL fail the lint
- **AND** the failure message SHALL reference `getBundledNodeDir()` as the correct alternative
