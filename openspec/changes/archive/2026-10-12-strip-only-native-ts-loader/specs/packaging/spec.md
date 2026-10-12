## MODIFIED Requirements

### Requirement: Bin entry is plain JavaScript wrapper
The package's `bin.pi-dashboard` field SHALL point to `bin/pi-dashboard.mjs`, a plain ESM JavaScript file that re-execs Node with the Node-native TypeScript loader (`--import <native-ts-register-url> packages/server/src/cli.ts <args>`, per `server-launch`). The wrapper SHALL NOT carry a jiti or tsx path; when the native register module cannot be resolved it SHALL exit 1 with an install-hint stderr message. No dashboard-server source SHALL import jiti. The package MAY keep `jiti` as a transitional runtime dependency, solely so a server started before this change (whose `execArgv` names a jiti register hook inside the install) can still be restarted across the upgrade; removing it is a separate, later change.

#### Scenario: Package bin entry after npm install
- **WHEN** the package is installed via `npm install`
- **THEN** the `pi-dashboard` symlink SHALL point to `bin/pi-dashboard.mjs`, an executable plain JS file that requires no TypeScript loader to parse itself

#### Scenario: Server source does not import jiti
- **WHEN** searching `packages/server/src`, `packages/server/bin` and `packages/shared/src` (excluding tests)
- **THEN** no file SHALL import or `require` `jiti`
