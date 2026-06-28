## ADDED Requirements

### Requirement: Affected-version-aware Node binary selection

The Electron app's Node binary picker (`pickNodeForServer`) SHALL skip the bundled Node candidate when its `--version` falls inside the `nodejs/node#58515` affected range (v22.0–v22.17 or v24.1–v24.2). The picker SHALL fall through to system Node when the bundled candidate is rejected on version grounds.

#### Scenario: Bundled Node is version-safe

- **WHEN** `pickNodeForServer` runs with `bundledNodeVersion = "v22.22.0"` AND the bundled binary exists
- **THEN** the picker SHALL return `{ kind: "bundled", nodeBin: <bundled path> }`

#### Scenario: Bundled Node is in the affected range

- **WHEN** `pickNodeForServer` runs with `bundledNodeVersion = "v22.12.0"` AND the bundled binary exists AND `systemNode.found = true` with path `/usr/local/bin/node`
- **THEN** the picker SHALL return `{ kind: "system", nodeBin: "/usr/local/bin/node", version: <system version> }`
- **AND** SHALL NOT return the bundled path

#### Scenario: Bundled affected and no system Node

- **WHEN** `pickNodeForServer` runs with `bundledNodeVersion = "v24.2.0"` AND the bundled binary exists AND `systemNode.found = false`
- **THEN** the picker SHALL return `{ kind: "execpath-fallback", nodeBin: <processExecPath>, needsElectronRunAsNode: true }`

#### Scenario: bundledNodeVersion not provided (legacy caller)

- **WHEN** `pickNodeForServer` runs WITHOUT a `bundledNodeVersion` input AND the bundled binary exists
- **THEN** the picker SHALL return `{ kind: "bundled", nodeBin: <bundled path> }` regardless of the binary's actual version
- **AND** behavior SHALL be identical to the pre-change implementation

### Requirement: On-disk system Node fallback

`detectSystemNode()` SHALL scan a fixed list of well-known on-disk Node locations when (a) the registry / login-shell lookup yields no path, OR (b) the resolved path's version is in the affected range. The scan SHALL return the highest-version Node binary that is both >=20.6 AND not in the affected range. The scan SHALL be Unix-only (POSIX); on `win32` the function SHALL behave as before.

#### Scenario: PATH-based lookup fails, nvm Node available

- **WHEN** `detectSystemNode()` runs on darwin AND the registry probe returns `{ found: false }` AND `~/.nvm/versions/node/v22.22.0/bin/node` exists and reports `v22.22.0`
- **THEN** the function SHALL return `{ found: true, path: "~/.nvm/versions/node/v22.22.0/bin/node", source: "system" }`

#### Scenario: PATH lookup returns an affected version, disk scan finds safe one

- **WHEN** `detectSystemNode()` runs AND the registry probe returns path `/usr/local/bin/node` reporting `v22.10.0` AND `~/.nvm/versions/node/v22.22.0/bin/node` exists reporting `v22.22.0`
- **THEN** the function SHALL skip the affected `/usr/local/bin/node`
- **AND** SHALL return the nvm v22.22.0 path

#### Scenario: Multiple nvm versions installed, pick highest safe

- **WHEN** `~/.nvm/versions/node/` contains `v20.10.0`, `v22.18.0`, `v22.22.0` AND all three binaries report their version correctly
- **THEN** the scan SHALL probe in semver-descending order
- **AND** SHALL return the `v22.22.0` path on first success

#### Scenario: Only affected versions on disk

- **WHEN** every candidate in the scan reports a version in the affected range AND no other Node is found
- **THEN** the function SHALL return `{ found: false, resolution: <registry trail> }`

#### Scenario: Windows host

- **WHEN** `detectSystemNode()` runs on `win32`
- **THEN** the disk-scan SHALL NOT execute
- **AND** the function SHALL behave per pre-change semantics

#### Scenario: Candidate probe times out

- **WHEN** a candidate Node binary's `--version` invocation does not return within 5 seconds
- **THEN** the candidate SHALL be skipped
- **AND** the scan SHALL continue to the next candidate
