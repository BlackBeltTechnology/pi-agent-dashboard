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
- **THEN** strategies SHALL be tried in order: `override`, `bundled-git-bash` (win32 only: `<resourcesPath>\git\usr\bin\bash.exe` when the bundled git tree exists; fails fast on other platforms), `managed` (`MANAGED_BIN/bash`), `where` (delegating to `ToolResolver.which("bash")`)
- **AND** the `managed` slot SHALL be retained for chain uniformity with other binary tools even though `bash` is not currently npm-installable (the archived `fix-doctor-stale-managed-install-check` already deprecated the false "managed install incomplete" Doctor advisory)

### Requirement: `bash` is a registered binary tool

The registry SHALL ship with a `bash` definition of `kind: "binary"`. The definition SHALL be registered on every platform (`darwin`, `linux`, `win32`). `bash` is a meaningful concept on all three even when the resolved path differs (`/bin/bash`, `/opt/homebrew/bin/bash`, `C:\Program Files\Git\bin\bash.exe`, the Electron bundle's `usr\bin\bash.exe`). The definition SHALL use the strategy chain `override`, `bundled-git-bash`, `managed` (`MANAGED_BIN/bash`), `where` (delegating to `ToolResolver.which("bash")`). The `bundled-git-bash` strategy SHALL resolve only a file named `bash.exe`; a bundle that ships only `sh.exe` SHALL NOT satisfy it.

#### Scenario: bash resolves to the bundled bash.exe on Windows Electron

- **WHEN** `registry.resolve("bash")` runs on `win32` with no override AND the bundled git tree contains `usr\bin\bash.exe`
- **THEN** the `bundled-git-bash` strategy SHALL succeed with that path
- **AND** `Resolution.source` SHALL equal `"bundled"`

#### Scenario: bundle with only sh.exe falls through

- **WHEN** `registry.resolve("bash")` runs on `win32` AND the bundled git tree contains `usr\bin\sh.exe` but no `usr\bin\bash.exe`
- **THEN** the `bundled-git-bash` strategy SHALL record `{ ok: false }` naming the missing `bash.exe`
- **AND** resolution SHALL continue with `managed` and `where`

#### Scenario: bash resolves via PATH on a system with Git-for-Windows

- **WHEN** `registry.resolve("bash")` runs on `win32` with no bundled git tree
- **AND** Git-for-Windows is installed so `bash.exe` is on PATH
- **THEN** the `where` strategy SHALL succeed
- **AND** `Resolution.path` SHALL be the absolute path returned by `ToolResolver.which("bash")`
- **AND** `Resolution.source` SHALL equal `"system"`

#### Scenario: bash resolves via PATH on macOS or Linux

- **WHEN** `registry.resolve("bash")` runs on `darwin` or `linux`
- **AND** `/bin/bash` (or a PATH entry resolving `bash`) exists
- **THEN** the `where` strategy SHALL succeed
- **AND** `Resolution.source` SHALL equal `"system"`

#### Scenario: bash not found on a host without Git-for-Windows or WSL on PATH

- **WHEN** `registry.resolve("bash")` runs on a host where no override is set, no bundled `bash.exe` exists, no managed install holds `bash`, and `bash` is not on PATH
- **THEN** every strategy SHALL record `{ ok: false, reason: <descriptive string> }`
- **AND** `Resolution.ok` SHALL be `false`
- **AND** `Resolution.path` SHALL be `null`

#### Scenario: bash override wins over PATH

- **WHEN** a user has registered an override for `"bash"` pointing to an existing file
- **THEN** the `override` strategy SHALL succeed
- **AND** `Resolution.source` SHALL equal `"override"`
- **AND** subsequent strategies SHALL NOT run
