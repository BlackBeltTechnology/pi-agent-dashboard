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
