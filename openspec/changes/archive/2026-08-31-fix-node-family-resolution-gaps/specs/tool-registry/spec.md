# tool-registry Specification

Absorbed from `fix-node-family-resolution-gaps` (superseded by user decision —
see this change's proposal, "Section-0 outcomes").

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
- **THEN** strategies SHALL be tried in order: `override`, `bare-import` (`import("@mariozechner/pi-coding-agent")`), `managed` (`~/.pi-dashboard/node_modules/@mariozechner/pi-coding-agent/dist/index.js`), `npm-global` (`<npm root -g>/@mariozechner/pi-coding-agent/dist/index.js`)
- **AND** a sibling strategy SHALL also probe `@oh-my-pi/pi-coding-agent` under both managed and npm-global paths

#### Scenario: bash strategy chain

- **WHEN** `registry.resolve("bash")` runs
- **THEN** strategies SHALL be tried in order: `override`, `managed` (`MANAGED_BIN/bash`), `where` (delegating to `ToolResolver.which("bash")`)
- **AND** the `managed` slot SHALL be retained for chain uniformity with other binary tools even though `bash` is not currently npm-installable (the archived `fix-doctor-stale-managed-install-check` already deprecated the false "managed install incomplete" Doctor advisory)

### Requirement: `bash` is a registered binary tool

The registry SHALL ship with a `bash` definition of `kind: "binary"`. The definition SHALL be registered on every platform (`darwin`, `linux`, `win32`). `bash` is a meaningful concept on all three even when the resolved path differs (`/bin/bash`, `/opt/homebrew/bin/bash`, `C:\Program Files\Git\bin\bash.exe`). The definition SHALL use the stock binary strategy chain: `override`, `managed` (`MANAGED_BIN/bash`), `where` (delegating to `ToolResolver.which("bash")`).

#### Scenario: bash resolves via PATH on a system with Git-for-Windows

- **WHEN** `registry.resolve("bash")` runs on `win32`
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

- **WHEN** `registry.resolve("bash")` runs on a host where no override is set, no managed install holds `bash`, and `bash` is not on PATH
- **THEN** every strategy SHALL record `{ ok: false, reason: <descriptive string> }`
- **AND** `Resolution.ok` SHALL be `false`
- **AND** `Resolution.path` SHALL be `null`

#### Scenario: bash override wins over PATH

- **WHEN** a user has registered an override for `"bash"` pointing to an existing file
- **THEN** the `override` strategy SHALL succeed
- **AND** `Resolution.source` SHALL equal `"override"`
- **AND** subsequent strategies SHALL NOT run

## ADDED Requirements

### Requirement: A rejected override is indicated on unresolved rows

The Settings → Tools status badge SHALL indicate a rejected override on rows where
the tool did NOT resolve, not only on rows that resolved via a fallback strategy. A
row whose override was rejected SHALL be visually distinguishable from a row that was
never configured, without requiring the user to expand it.

Existing surfaces are unchanged and SHALL NOT be re-implemented: the inline expanded
warning, the full `tried[]` trail (which already carries the offending path), and the
`ToolListEntry` / `/api/tools` payload. Fall-through behaviour is likewise unchanged
(see "Invalid override falls through").

#### Scenario: rejected override on a not-found row is distinguishable

- **WHEN** a tool has an override that recorded `invalid: <reason>` AND no later strategy resolved the tool
- **THEN** the collapsed row's status badge SHALL render a THIRD state, distinct from BOTH the ordinary not-found state AND the existing rejected-but-fell-back state
- **AND** the indicator's tooltip SHALL name the rejected path
- **AND** the three states SHALL be mutually distinguishable without expanding the row

#### Scenario: indicator wording distinguishes fell-back from did-not-resolve

- **WHEN** the rejected-override indicator is rendered on a row that did NOT resolve
- **THEN** its tooltip SHALL NOT claim a fallback was used
- **AND** a row that DID resolve via a later strategy SHALL retain its existing fallback wording

#### Scenario: unparseable rejection reason still yields an indicator

- **WHEN** the `invalid:` reason recorded for the override does not contain an extractable path (the registry's `validate` demotion path records `invalid: <validator reason>`, which carries no path guarantee, unlike `overrideStrategy`'s `invalid: path does not exist: <p>`)
- **THEN** the badge SHALL still indicate a rejected override
- **AND** the tooltip SHALL degrade to the reason text rather than rendering an empty or malformed path

#### Scenario: rejected override on a resolved row keeps its existing indicator

- **WHEN** a tool has a rejected override AND a later strategy resolved it
- **THEN** the existing fallback indicator SHALL continue to be shown
- **AND** its behaviour SHALL NOT change

#### Scenario: not-found row without an override is unchanged

- **WHEN** a tool fails to resolve and no override entry exists for it
- **THEN** the badge SHALL render the ordinary not-found state
- **AND** SHALL NOT suggest an override was involved
