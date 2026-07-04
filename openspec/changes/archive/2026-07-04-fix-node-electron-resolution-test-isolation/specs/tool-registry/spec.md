## ADDED Requirements

### Requirement: Node-script executor argv assembly is fully injectable under test

The Node-script `toArgv` transform (`nodeScriptToArgv`) and its JS-entry resolution (`resolveJsScript`) SHALL be drivable entirely from injected dependencies. When a test supplies interpreter (`execPath`) and filesystem (`exists`/`realpath`) seams, `resolveExecutor(...)` SHALL NOT read live machine state — no `process.execPath` fallback and no `realpathSync` against the real filesystem. The runtime defaults SHALL remain `process.execPath` and real `realpathSync`, so production resolution behavior is unchanged on every platform. Executor resolution SHALL therefore be deterministic regardless of the host machine's installed applications (`/Applications/PI-Dashboard.app`) or `PATH` (`~/.pi-dashboard/node`).

#### Scenario: Executor argv under mocked packaged-Electron layout does not leak real paths

- **WHEN** a test resolves `resolveExecutor("npm")` against a mocked packaged-Electron registry (injected `exists` for `BUNDLED_NPM`, injected `execPath`/`realpath` seams) on a developer machine that has the packaged app installed and a managed `node` on `PATH`
- **THEN** the resolved `argv` SHALL equal `[BUNDLED_NPM]`
- **AND** the resolved `argv` SHALL contain no real-filesystem path (`/Applications/PI-Dashboard.app`, `~/.pi-dashboard/node`) sourced from `process.execPath` or `realpathSync`

#### Scenario: Runtime default interpreter and realpath preserved

- **WHEN** no `execPath` or `realpath` seam is injected (normal runtime)
- **THEN** `nodeScriptToArgv` SHALL fall back to `process.execPath` and `resolveJsScript` SHALL use real `realpathSync`, exactly as before this change
- **AND** healthy packaged-Electron resolution SHALL short-circuit at `bundledNodeStrategy("node")` before reaching the interpreter fallback, so the Electron spawn path is unaffected
