# fix-pty-permissions Specification

## Purpose

Repair node-pty's prebuilt `spawn-helper` binary permissions at runtime so the terminal gateway can allocate ptys. On macOS/Linux the prebuilt `spawn-helper` may lack the execute bit (npm hoisting skips the postinstall fix, especially in Electron bundles); this utility finds every bundled `spawn-helper` and restores its execute permission. It runs once when the terminal manager is created.

## Requirements

### Requirement: Platform and single-run guarding

The utility SHALL execute its repair logic at most once per process and SHALL take no action on Windows.

#### Scenario: Windows platform is a no-op

- WHEN `fixPtyPermissions` is called and `process.platform` is `win32`
- THEN the utility SHALL return without inspecting or modifying any file

#### Scenario: Repair runs only once

- WHEN `fixPtyPermissions` is called more than once in the same process
- THEN only the first call SHALL perform inspection and repair
- AND every subsequent call SHALL return without re-inspecting files

### Requirement: Locate bundled spawn-helper binaries

The utility SHALL locate node-pty's install directory via module resolution and scan its sibling `prebuilds` directory for platform subdirectories.

#### Scenario: node-pty is not resolvable

- WHEN node-pty cannot be resolved via `require.resolve("node-pty")`
- THEN the utility SHALL skip silently without throwing

#### Scenario: prebuilds directory is absent

- WHEN the `prebuilds` directory (sibling of node-pty's main directory) does not exist
- THEN the utility SHALL return without modifying any file

#### Scenario: prebuilds directory contains platform subdirectories

- WHEN the `prebuilds` directory exists
- THEN the utility SHALL iterate each entry under `prebuilds`
- AND for each entry SHALL target the `spawn-helper` file inside that subdirectory

### Requirement: Repair missing execute permission

The utility SHALL grant execute permission to any `spawn-helper` binary that lacks it and SHALL leave already-executable binaries unchanged.

#### Scenario: spawn-helper lacks the execute bit

- WHEN a `spawn-helper` file exists and its mode has no execute bits set (mode & `0o111` is zero)
- THEN the utility SHALL change its mode to `0o755`
- AND SHALL log `[pty] Fixed spawn-helper permissions: <path>`

#### Scenario: spawn-helper is already executable

- WHEN a `spawn-helper` file exists and its mode already has an execute bit set
- THEN the utility SHALL leave the file unchanged and SHALL NOT log

#### Scenario: spawn-helper is missing for a platform subdirectory

- WHEN a platform subdirectory under `prebuilds` has no `spawn-helper` file
- THEN the utility SHALL skip that subdirectory silently and continue with the remaining subdirectories
