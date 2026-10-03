## MODIFIED Requirements

### Requirement: Registered tool set

The registry SHALL ship with definitions for at minimum: `pi` (binary), `pi-coding-agent` (module), `openspec` (binary), `npm` (binary), `npx` (binary), `node` (binary), `tsx` (binary), `git` (binary), `zrok` (binary), `gh` (binary), AND `bash` (binary). Each definition SHALL declare an ordered strategy chain and a `classify` function mapping resolved paths to `source` values.

The `node`, `npm`, and `npx` tools are members of ONE Node distribution and SHALL each
probe the managed Node runtime root, so an installed managed runtime is visible to
every member of the family rather than to a subset of it. Their chains are NOT
otherwise required to be identical — `npm` has no `managedBin` step, and `npm` on
`win32` has an additional `npmCliBesideNode` step.

#### Scenario: node strategy chain

- **WHEN** `registry.resolve("node")` runs
- **THEN** strategies SHALL be tried in order: `override`, `bundled-node` (`<resourcesPath>/node/bin/node` Unix / `\node\node.exe` Windows), `managedRuntime` (`<managedDir>/node/bin/node` Unix / `\node\node.exe` Windows), `managedBin` (`<managedDir>/node_modules/.bin/node`), `where` (delegating to `ToolResolver.which("node")`)

#### Scenario: npm strategy chain

- **WHEN** `registry.resolveExecutor("npm")` runs
- **THEN** strategies SHALL be tried in order: `override`, `bundled-node` (`<resourcesPath>/node/bin/npm` Unix / `\node\npm.cmd` Windows), `managedRuntime` (`<managedDir>/node/bin/npm` Unix / `\node\npm.cmd` Windows), then on `win32` only `npmCliBesideNode`, then `where`
- **AND** the chain SHALL NOT include a `managedBin` step, which is not implemented for `npm` on any platform

#### Scenario: npx strategy chain

- **WHEN** `registry.resolve("npx")` runs
- **THEN** strategies SHALL be tried in order: `override`, `bundled-node` (`<resourcesPath>/node/bin/npx` Unix / `\node\npx.cmd` Windows), `managedRuntime` (`<managedDir>/node/bin/npx` Unix / `\node\npx.cmd` Windows), `managedBin` (`MANAGED_BIN/npx`), `where` (delegating to `ToolResolver.which("npx")`)

#### Scenario: an installed managed Node runtime is visible to every family member

- **WHEN** a managed Node runtime is installed at `<managedDir>/node/` providing all three binaries, and no override or bundled runtime is present
- **THEN** `resolve("node")`, `resolve("npm")`, and `resolve("npx")` SHALL each resolve into that managed runtime
- **AND** no family member SHALL fall through to `where`/PATH while the managed runtime provides that member

#### Scenario: pi strategy chain

- **WHEN** `registry.resolve("pi")` runs
- **THEN** strategies SHALL be tried in order: `override`, `managed` (`MANAGED_BIN/pi.cmd` on Windows, `MANAGED_BIN/pi` elsewhere), `where` (delegating to `ToolResolver.which("pi")`)

#### Scenario: pi-coding-agent strategy chain

- **WHEN** `registry.resolveModule("pi-coding-agent")` runs
- **THEN** strategies SHALL be tried in order: `override`, `bare-import` (`import("@earendil-works/pi-coding-agent")`), `managed` (`~/.pi-dashboard/node_modules/@earendil-works/pi-coding-agent/dist/index.js`), `npm-global` (`<npm root -g>/@earendil-works/pi-coding-agent/dist/index.js`)
- **AND** no strategy SHALL probe `@mariozechner/pi-coding-agent` or `@oh-my-pi/pi-coding-agent`

#### Scenario: pi executor and pi-ai module probe only earendil packages

- **WHEN** `registry.resolveExecutor("pi")` or `registry.resolveModule("pi-ai")` runs
- **THEN** package-based strategies SHALL probe only `@earendil-works/pi-coding-agent` (executor) or `@earendil-works/pi-ai` (module)
- **AND** SHALL NOT probe `@mariozechner/pi-coding-agent` or `@mariozechner/pi-ai`

#### Scenario: bash strategy chain

- **WHEN** `registry.resolve("bash")` runs
- **THEN** strategies SHALL be tried in order: `override`, `managed` (`MANAGED_BIN/bash`), `where` (delegating to `ToolResolver.which("bash")`)
- **AND** the `managed` slot SHALL be retained for chain uniformity with other binary tools even though `bash` is not currently npm-installable (the archived `fix-doctor-stale-managed-install-check` already deprecated the false "managed install incomplete" Doctor advisory)
