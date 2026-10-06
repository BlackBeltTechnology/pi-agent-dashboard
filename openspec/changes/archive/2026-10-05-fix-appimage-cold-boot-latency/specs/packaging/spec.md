## MODIFIED Requirements

### Requirement: Bin entry is plain JavaScript wrapper (jiti-only)
The package's `bin.pi-dashboard` field SHALL point to `bin/pi-dashboard.mjs`, a plain ESM JavaScript file that selects a TypeScript loader at runtime (Node-native by default, jiti when `PI_DASHBOARD_TS_LOADER=jiti`, per `server-launch`) and re-execs Node with `--import <loader-url> packages/server/src/cli.ts <args>`. The wrapper SHALL NOT carry a tsx fallback; when jiti is selected and jiti resolution fails it SHALL exit 1 with an install-hint stderr message.

#### Scenario: Package bin entry after npm install
- **WHEN** the package is installed via `npm install`
- **THEN** the `pi-dashboard` symlink SHALL point to `bin/pi-dashboard.mjs`, an executable plain JS file that requires no TypeScript loader to parse itself
