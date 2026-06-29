## ADDED Requirements

### Requirement: macos-alias native module readiness on darwin

When the Electron build pipeline runs on `darwin`, the `macos-alias` native module (transitive dep of `@electron-forge/maker-dmg`) MUST have its `build/Release/volume.node` compiled before `electron-forge make` is invoked. The pipeline SHALL self-heal a missing build via `npm rebuild macos-alias`, and SHALL fail with an actionable error message when self-heal is impossible.

#### Scenario: Postinstall succeeds

- **WHEN** `pnpm install` (or `npm install`) runs on darwin AND `macos-alias` is present in the workspace AND Xcode Command Line Tools are installed
- **THEN** the `packages/electron/postinstall` hook SHALL produce `<macos-alias-dir>/build/Release/volume.node`
- **AND** SHALL exit zero

#### Scenario: Postinstall on non-darwin host

- **WHEN** the postinstall hook runs on `linux` or `win32`
- **THEN** the hook SHALL exit zero immediately without attempting to build
- **AND** SHALL NOT print warnings

#### Scenario: Postinstall fails (no CLT) — non-fatal

- **WHEN** the postinstall hook runs on darwin AND Xcode Command Line Tools are NOT installed AND `npm rebuild macos-alias` fails
- **THEN** the hook SHALL print a clear suggestion (e.g., "run `xcode-select --install`")
- **AND** SHALL exit zero (does not block `pnpm install`)

#### Scenario: Build-time gate catches missing native module

- **WHEN** `build-installer.sh` runs on darwin with a make target that produces a DMG AND `volume.node` is not present
- **THEN** the script SHALL invoke the rebuild routine
- **AND** if rebuild fails, SHALL exit non-zero before `electron-forge make` runs
- **AND** SHALL print an actionable message naming `xcode-select --install` as the recovery step

#### Scenario: Build-time gate passes silently when ready

- **WHEN** `build-installer.sh` runs on darwin AND `volume.node` is present
- **THEN** the script SHALL proceed to `electron-forge make` without printing rebuild output

### Requirement: Doctor diagnostic for DMG prerequisites

The Electron Doctor window SHALL include a darwin-only diagnostic row for the `macos-alias` native module readiness state. The row SHALL show `ok` when `volume.node` is present and `warn` otherwise. The `warn` state SHALL include a remediation suggestion referencing the postinstall command and Xcode CLT.

#### Scenario: Doctor row on darwin with built native module

- **WHEN** Doctor runs on darwin AND `<macos-alias-dir>/build/Release/volume.node` exists
- **THEN** the Doctor report SHALL include a row `{ id: "macos-alias-volume", state: "ok" }`

#### Scenario: Doctor row on darwin with missing native module

- **WHEN** Doctor runs on darwin AND `volume.node` does not exist
- **THEN** the Doctor report SHALL include a row `{ id: "macos-alias-volume", state: "warn", suggestion: <non-empty> }`

#### Scenario: Doctor on non-darwin

- **WHEN** Doctor runs on `linux` or `win32`
- **THEN** the report SHALL NOT include the `macos-alias-volume` row
