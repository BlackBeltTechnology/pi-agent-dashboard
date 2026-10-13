## MODIFIED Requirements

### Requirement: Bundled Node.js binary
The Electron app SHALL include a standalone Node.js binary as `extraResources`, whose version satisfies the dashboard server's `engines.node` range (today a Node 26 LTS release). The bundle SHALL include the `node` (or `node.exe`) executable, the `npm` CLI module under `node_modules/npm/`, and on Windows the `npm.cmd` and `npx.cmd` shim scripts shipped with the upstream Node Windows distribution.

#### Scenario: Bundled Node exists in packaged app
- **WHEN** the Electron app is installed
- **THEN** the bundled Node binary SHALL exist at `<app>/resources/node/bin/node` (macOS/Linux) or `<app>/resources/node/node.exe` (Windows)
- **AND** bundled npm SHALL exist at `<app>/resources/node/lib/node_modules/npm/` (macOS/Linux) or `<app>/resources/node/node_modules/npm/` (Windows)

#### Scenario: Bundled Node satisfies the server engines range
- **WHEN** the packaged bundled Node binary is run with `--version`
- **THEN** the reported version SHALL satisfy the dashboard server's `engines.node` range (`>=26.0.0 <27`)
- **AND** the dashboard server SHALL start on it without the Node-version guard refusing

#### Scenario: Windows bundle includes npm shim scripts
- **WHEN** the Electron app is installed on Windows
- **THEN** `<app>/resources/node/npm.cmd` SHALL exist
- **AND** `<app>/resources/node/npx.cmd` SHALL exist
- **AND** invoking `<app>/resources/node/npm.cmd --version` SHALL exit 0 and print the bundled npm version

#### Scenario: Unix bundle includes npm shim
- **WHEN** the Electron app is installed on macOS or Linux
- **THEN** `<app>/resources/node/bin/npm` SHALL exist (symlink or shim) and SHALL invoke the bundled npm-cli.js when executed
