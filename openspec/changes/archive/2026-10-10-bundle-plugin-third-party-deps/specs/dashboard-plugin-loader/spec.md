## MODIFIED Requirements

### Requirement: First-party monorepo plugins SHALL ship inside the Electron bundle

`bundle-server.mjs` SHALL copy every first-party plugin listed in `packages/server/package.json#piDashboard.bundledPlugins` (each a `pi-dashboard-plugin` package under `packages/`) into `<bundle>/resources/plugins/<id>/`, EXCEPT plugins whose manifest declares `fixture: true`. The runtime `findBundledPluginsDir()` SHALL locate the resulting directory at `~/.pi-dashboard/resources/plugins/` after extraction.

The bundled set SHALL include at minimum: `roles-plugin`, `flows-plugin`, `flows-anthropic-bridge-plugin`. Fixture-only plugins (e.g. `demo-plugin`) SHALL be excluded.

Every package in a bundled plugin's `dependencies` (first-party and third-party; `peerDependencies` and `optionalDependencies` excluded) SHALL be resolvable from `<bundle>/resources/plugins/<id>/` inside the bundle, so a bundled plugin's server entry never fails to load because a declared dependency is absent.

#### Scenario: Bundled plugins land under resources/plugins

- **WHEN** `npm run electron:bundle-server` completes
- **THEN** `packages/electron/resources/server/resources/plugins/` SHALL contain a subdirectory per bundled plugin id, each with a valid `package.json` carrying a `pi-dashboard-plugin` manifest.

#### Scenario: Fresh Electron install discovers bundled plugins

- **WHEN** a fresh `~/.pi-dashboard/` is populated from the bundle and the server starts
- **THEN** `discoverPlugins()` SHALL return at least the bundled set, AND `/api/plugins` SHALL list them with their manifest summaries.

#### Scenario: Bundled plugin third-party imports resolve

- **WHEN** a fresh Electron install starts the bundled server with `gmail-plugin` enabled
- **THEN** the plugin's server entry SHALL load without `Cannot find module 'oauth4webapi'`
- **AND** `/api/plugins` SHALL report `gmail` as loaded with no error
