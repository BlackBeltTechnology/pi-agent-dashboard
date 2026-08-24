# bundled-node-runtime Specification

## Purpose

Lets the packaged application run without a system Node.js install by shipping a platform-appropriate Node binary. Defines how the correct binary is selected per platform and how the bundled runtime is resolved at execution time so bundled and development modes behave identically.

## Requirements

### Requirement: Bundled Node.js binary
The Electron app SHALL include a standalone Node.js v22 LTS binary as `extraResources`. The bundle SHALL include the `node` (or `node.exe`) executable, the `npm` CLI module under `node_modules/npm/`, and on Windows the `npm.cmd` and `npx.cmd` shim scripts shipped with the upstream Node Windows distribution.

#### Scenario: Bundled Node exists in packaged app
- **WHEN** the Electron app is installed
- **THEN** the bundled Node binary SHALL exist at `<app>/resources/node/bin/node` (macOS/Linux) or `<app>/resources/node/node.exe` (Windows)
- **AND** bundled npm SHALL exist at `<app>/resources/node/lib/node_modules/npm/` (macOS/Linux) or `<app>/resources/node/node_modules/npm/` (Windows)

#### Scenario: Windows bundle includes npm shim scripts
- **WHEN** the Electron app is installed on Windows
- **THEN** `<app>/resources/node/npm.cmd` SHALL exist
- **AND** `<app>/resources/node/npx.cmd` SHALL exist
- **AND** invoking `<app>/resources/node/npm.cmd --version` SHALL exit 0 and print the bundled npm version

#### Scenario: Unix bundle includes npm shim
- **WHEN** the Electron app is installed on macOS or Linux
- **THEN** `<app>/resources/node/bin/npm` SHALL exist (symlink or shim) and SHALL invoke the bundled npm-cli.js when executed

### Requirement: Platform-specific binary selection
The build pipeline SHALL select the correct Node.js binary for the target platform and architecture during packaging.

#### Scenario: macOS arm64 build
- **WHEN** building for macOS arm64
- **THEN** the Node.js darwin-arm64 binary SHALL be included in extraResources

#### Scenario: Linux x64 build
- **WHEN** building for Linux x64
- **THEN** the Node.js linux-x64 binary SHALL be included in extraResources

#### Scenario: Windows x64 build
- **WHEN** building for Windows x64
- **THEN** the Node.js win-x64 binary SHALL be included in extraResources

### Requirement: Bundled Node resolves at runtime
The Electron main process SHALL expose a helper function to resolve the bundled Node and npm paths, accounting for packaged vs development layouts.

#### Scenario: Resolve bundled node path
- **WHEN** `getBundledNodePath()` is called in a packaged app
- **THEN** it SHALL return the absolute path to the bundled `node` binary

#### Scenario: Resolve bundled npm path
- **WHEN** `getBundledNpmPath()` is called in a packaged app
- **THEN** it SHALL return the absolute path to the bundled `npm` CLI script
