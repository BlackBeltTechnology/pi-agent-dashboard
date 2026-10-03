## ADDED Requirements

### Requirement: Pi module resolution from the earendil package only

`loadPiPackageManager()` SHALL resolve pi's `DefaultPackageManager` and `SettingsManager` from `@earendil-works/pi-coding-agent` using the following ordered resolution chain. The function SHALL NOT probe `@mariozechner/pi-coding-agent` or `@oh-my-pi/pi-coding-agent`.

1. Direct import of `@earendil-works/pi-coding-agent`.
2. Managed install — `~/.pi-dashboard/node_modules/@earendil-works/pi-coding-agent/dist/index.js`.
3. Global npm root via `npm root -g` — `<root>/@earendil-works/pi-coding-agent`.

The function SHALL return the first successful resolution and cache the result. If all paths fail, it SHALL throw an error with message "pi-coding-agent is not installed."

#### Scenario: Pi found in earendil global install

- **WHEN** `@earendil-works/pi-coding-agent` is installed globally
- **THEN** `loadPiPackageManager()` resolves successfully via the direct-import or managed-install path

#### Scenario: Pi found in managed install directory

- **WHEN** direct import fails
- **AND** pi is installed at `~/.pi-dashboard/node_modules/@earendil-works/pi-coding-agent/dist/index.js`
- **THEN** `loadPiPackageManager()` resolves successfully and returns `DefaultPackageManager` and `SettingsManager`

#### Scenario: Legacy fork alongside earendil is ignored

- **WHEN** both `@earendil-works/pi-coding-agent` and `@mariozechner/pi-coding-agent` are installed under `~/.pi-dashboard/node_modules/`
- **THEN** the resolver SHALL resolve `@earendil-works/pi-coding-agent`
- **AND** SHALL NOT probe the legacy fork, which SHALL remain on disk untouched

#### Scenario: Legacy-fork-only install is not resolved

- **WHEN** only `@mariozechner/pi-coding-agent` is installed (globally or in the managed install)
- **THEN** `loadPiPackageManager()` SHALL throw "pi-coding-agent is not installed"
- **AND** the dashboard SHALL surface the install hint for `@earendil-works/pi-coding-agent`

#### Scenario: Managed install not present falls through to global npm

- **WHEN** direct import fails AND managed install directory does not contain pi
- **THEN** resolution falls through to global npm root check without error

#### Scenario: All resolution paths fail

- **WHEN** direct import, managed install, and global npm all fail
- **THEN** `loadPiPackageManager()` throws an error with message containing "pi-coding-agent is not installed"

#### Scenario: oh-my-pi install ignored

- **WHEN** only `@oh-my-pi/pi-coding-agent` is installed
- **THEN** `loadPiPackageManager()` SHALL throw "pi-coding-agent is not installed"
- **AND** the dashboard SHALL surface the install hint for `@earendil-works/pi-coding-agent`

## REMOVED Requirements

### Requirement: Pi module resolution
**Reason**: The `@mariozechner/pi-coding-agent` fork is no longer a supported pi; the old block's fork-specific scenarios cannot be dropped through MODIFIED.
**Migration**: Replaced by "Pi module resolution from the earendil package only". Fork-only machines install `@earendil-works/pi-coding-agent`.
