# doctor-diagnostic — delta

## ADDED Requirements

### Requirement: Bundle-aware probe order for runtime dependencies
For dependencies that ship inside the bundled Electron tree (`jiti`, `tsx`, `pi-coding-agent`, `openspec`), Doctor probes SHALL consult `<resourcesPath>/server/node_modules/<pkg>/package.json` FIRST, before falling back to the legacy managed-dir + PATH probe order.

The probe SHALL be skipped when `resourcesPath` is null (e.g. the standalone npm-global install arm, where there is no Electron resources tree). In that arm the existing managed-dir + PATH probe order applies unchanged.

On a positive bundle match, the check's `message` field SHALL include the literal substring `(bundled)` and the package's resolved path. On a negative bundle match (Electron context, bundle dir present, package subdir absent), the check status SHALL be `error` and the remediation SHALL describe the install as corrupted, not as needing setup.

#### Scenario: Bundled jiti detected
- **WHEN** Doctor runs on Electron with `resourcesPath = "/path/to/resources"` and `resources/server/node_modules/jiti/package.json` exists with `{"version": "2.4.1"}`
- **THEN** the `TypeScript loader` check status SHALL be `ok`
- **AND** the message SHALL contain `jiti v2.4.1 (bundled)`
- **AND** the message SHALL contain the absolute path to the bundled jiti directory

#### Scenario: Bundled pi detected
- **WHEN** Doctor runs on Electron with `resources/server/node_modules/pi-coding-agent/package.json` present and `bin.pi` resolving to an existing file
- **THEN** the `pi CLI` check status SHALL be `ok`
- **AND** the message SHALL contain `pi (bundled)` and the absolute path of the `pi` bin entry

#### Scenario: Bundled openspec detected
- **WHEN** Doctor runs on Electron with `resources/server/node_modules/openspec/package.json` present
- **THEN** the `openspec CLI` check status SHALL be `ok` (`warning` no longer applies in this context)

#### Scenario: Standalone arm unaffected
- **WHEN** Doctor runs on a standalone `npm i -g` install with `resourcesPath = null`
- **THEN** the `TypeScript loader`, `pi CLI`, and `openspec CLI` checks SHALL probe `<managedDir>/node_modules/*` and PATH exactly as before this change
- **AND** the messages SHALL NOT contain `(bundled)`

### Requirement: Corrupted-install remediation distinguishes from setup-needed
When Doctor runs in an Electron context (`resourcesPath != null`) and a bundle-aware probe returns negative (the package subdir is absent under `resources/server/node_modules/<pkg>/`), the remediation text SHALL describe the install as corrupted and direct the user to reinstall from the official Releases page. The remediation SHALL NOT instruct the user to "run the setup wizard" — post `eliminate-electron-runtime-install` the setup wizard does not have a writable target that can repair this state.

For standalone-arm callers (`resourcesPath == null`), the existing setup-wizard remediation text remains correct and SHALL be preserved.

#### Scenario: Electron corrupted-install message
- **WHEN** the Electron-context probe for `jiti` returns negative
- **THEN** the remediation field SHALL contain the substring `corrupted` (or equivalent — not "setup wizard")
- **AND** SHALL name the expected bundle path

#### Scenario: Standalone setup-wizard message preserved
- **WHEN** a standalone-arm probe for `jiti` returns negative
- **THEN** the remediation field SHALL contain the substring `setup wizard` (existing text unchanged)

### Requirement: runSharedChecks surfaces bundled-runtime rows when resourcesPath set
When `runSharedChecks` is invoked with a non-null `resourcesPath`, the returned check list SHALL include the following rows in addition to the existing shared checks: `Bundled Node.js`, `Bundled npm`, `Bundled Node runtime`, `Dashboard server code`, `Server starter`. These rows SHALL be omitted when `resourcesPath` is null (standalone arm). The intent is parity between the server-side `/api/doctor` surface (consumed by Settings → Diagnostics) and the Electron-side Doctor window for every check that can be performed without Electron-internal APIs.

The Electron-side `packages/electron/src/lib/doctor.ts` SHALL stop emitting these five rows directly (they now come from shared) and SHALL retain only the `Electron <version>` row, which is the sole row that requires Electron-internal APIs.

#### Scenario: Settings → Diagnostics shows bundled-Node row on Electron
- **WHEN** the Electron-launched server serves `/api/doctor` AND `<resourcesPath>/node/node.exe` exists (or `/node/bin/node` on POSIX)
- **THEN** the response SHALL contain a check named `Bundled Node.js` with status `ok`
- **AND** the message SHALL include the version (`v22.18.0`) and the absolute path of the bundled Node binary

#### Scenario: Settings → Diagnostics shows bundled npm row
- **WHEN** the same conditions AND `<resourcesPath>/node/node_modules/npm/bin/npm-cli.js` exists
- **THEN** the response SHALL contain a check named `Bundled npm` with status `ok` and a version from `npm-cli.js --version`

#### Scenario: Settings → Diagnostics shows server-starter row
- **WHEN** the server has been launched by Electron AND `/api/health` returns `{ launchSource: "electron", … }`
- **THEN** the response SHALL contain a check named `Server starter` with status `ok` and a message identifying the starter as `electron`
- **AND** the legacy `starter` field SHALL be honoured as a fallback for one minor version

#### Scenario: Standalone arm does not emit bundled rows
- **WHEN** `runSharedChecks` is invoked with `resourcesPath: null` (standalone npm-global install)
- **THEN** the returned check list SHALL NOT contain any of `Bundled Node.js`, `Bundled npm`, `Bundled Node runtime`, `Dashboard server code`, `Server starter`

#### Scenario: Electron-side doctor.ts no longer double-emits lifted rows
- **WHEN** `packages/electron/src/lib/doctor.ts` composes the final check list (shared + Electron-only rows)
- **THEN** the output SHALL contain each of `Bundled Node.js`, `Bundled npm`, `Bundled Node runtime`, `Dashboard server code`, `Server starter` exactly once
- **AND** the source of each of those five rows SHALL be the shared check (no Electron-side duplicate emission)

### Requirement: System Node check excludes bundled-node-dir leakage
The `System Node.js` check in `runSharedChecks` SHALL classify a `detectSystemNode()` hit as `not-found-on-PATH` (warning row, existing text) when the returned path resolves under `<resourcesPath>/node/` (path-prefix match; case-insensitive on win32). This prevents the bundled Node — prepended to PATH by `ToolResolver.buildSpawnEnv` so the server can spawn its own children — from being misreported as a system installation.

The new `Bundled Node.js` row (from the previous Requirement) carries the bundled-node information honestly; the `System Node.js` row reports the actual system-Node state.

#### Scenario: Bundled Node on PATH not reported as System Node
- **WHEN** `detectSystemNode()` returns `{ found: true, path: "<resourcesPath>/node/node.exe" }` AND `resourcesPath` is non-null
- **THEN** the `System Node.js` check status SHALL be `warning`
- **AND** the message SHALL be `Not found on PATH (bundled Node will be used)` (existing not-found text)
- **AND** the detail SHALL note that a binary at the bundled path was filtered

#### Scenario: Real system Node still reported when present
- **WHEN** `detectSystemNode()` returns `{ found: true, path: "C:\\Program Files\\nodejs\\node.exe" }` (a non-bundled path)
- **THEN** the `System Node.js` check status SHALL be `ok`
- **AND** the message SHALL include the version and the system path

#### Scenario: Standalone arm unaffected
- **WHEN** `resourcesPath` is null
- **THEN** the `System Node.js` check behaves as before this change (no filtering)
