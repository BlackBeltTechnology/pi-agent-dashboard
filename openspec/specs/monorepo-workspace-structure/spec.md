# monorepo-workspace-structure

## Purpose

Defines the npm workspaces monorepo layout for PI Dashboard: which packages live under `packages/`, the `@blackbelt-technology/pi-dashboard-*` naming convention, the inter-package dependency graph, shared TypeScript configuration, root-level dev scripts, and the publication policy (public runtime packages + private Electron).

## Requirements

### Requirement: npm workspace layout
The project SHALL be structured as an npm workspaces monorepo with four packages under `packages/`: `shared`, `server`, `extension`, and `client`.

#### Scenario: Workspace root lists all packages
- **WHEN** the root `package.json` is read
- **THEN** `workspaces` field SHALL contain `["packages/*"]`

#### Scenario: Each package has its own package.json
- **WHEN** listing `packages/shared/`, `packages/server/`, `packages/extension/`, `packages/client/`
- **THEN** each directory SHALL contain a `package.json` with its own `name`, `version`, and `dependencies`

### Requirement: Package naming convention
Each package SHALL use the `@blackbelt-technology/pi-dashboard-*` scope:
- `@blackbelt-technology/pi-dashboard-shared`
- `@blackbelt-technology/pi-dashboard-server`
- `@blackbelt-technology/pi-dashboard-extension`
- `@blackbelt-technology/pi-dashboard-web`

#### Scenario: Package names match convention
- **WHEN** reading `packages/*/package.json`
- **THEN** each `name` field SHALL match `@blackbelt-technology/pi-dashboard-{shared,server,extension,web}`

### Requirement: Shared package has zero internal dependencies
The shared package SHALL NOT depend on server, extension, or client packages.

#### Scenario: Shared package.json has no workspace deps
- **WHEN** reading `packages/shared/package.json`
- **THEN** `dependencies` SHALL NOT contain any `@blackbelt-technology/pi-dashboard-*` package

### Requirement: Server, extension, and client depend only on shared
Each non-shared package SHALL depend on `@blackbelt-technology/pi-dashboard-shared` and SHALL NOT depend on other workspace packages.

#### Scenario: Server depends on shared only
- **WHEN** reading `packages/server/package.json`
- **THEN** workspace dependencies SHALL include only `@blackbelt-technology/pi-dashboard-shared`

#### Scenario: Extension depends on shared only
- **WHEN** reading `packages/extension/package.json`
- **THEN** workspace dependencies SHALL include only `@blackbelt-technology/pi-dashboard-shared`

#### Scenario: Client depends on shared only
- **WHEN** reading `packages/client/package.json`
- **THEN** workspace dependencies SHALL include only `@blackbelt-technology/pi-dashboard-shared`

### Requirement: Shared TypeScript base config
A root `tsconfig.base.json` SHALL define shared compiler options. Each package's `tsconfig.json` SHALL extend it.

#### Scenario: Package tsconfigs extend base
- **WHEN** reading `packages/*/tsconfig.json`
- **THEN** each SHALL contain `"extends": "../../tsconfig.base.json"`

### Requirement: Package tsconfigs declare no project references
Package `tsconfig.json` files SHALL NOT declare a TypeScript `references` array unless the repository adopts composite project build mode (every referenced project sets `"composite": true` and builds run via `tsc -b`). The canonical type-check is the root flat program (`tsc --noEmit` over `packages/*/src`), which does not use project references.

#### Scenario: No package tsconfig declares references
- **WHEN** reading `packages/*/tsconfig.json`
- **THEN** no file SHALL contain a `references` array

#### Scenario: Isolated single-project type-check does not error
- **WHEN** running `tsc --noEmit -p packages/extension`
- **THEN** TypeScript SHALL NOT raise `TS6306` (referenced project must have "composite": true)

#### Scenario: Canonical root type-check stays green
- **WHEN** running `tsc --noEmit` from the repo root
- **THEN** the command SHALL exit 0

### Requirement: Root-level dev scripts work
The root `package.json` SHALL provide scripts that orchestrate across workspaces: `npm test`, `npm run dev`, `npm run build`, `npm run reload`.

#### Scenario: npm test runs all package tests
- **WHEN** running `npm test` from the root
- **THEN** vitest SHALL execute tests from all four packages

#### Scenario: npm run build builds the client
- **WHEN** running `npm run build` from the root
- **THEN** the client package's Vite build SHALL produce output in `packages/client/dist/`

### Requirement: Import paths use package names
All cross-package imports SHALL use the package name (e.g., `@blackbelt-technology/pi-dashboard-shared/types.js`) instead of relative paths (`../shared/types.js`).

#### Scenario: No relative cross-package imports exist
- **WHEN** searching for `from "../shared/"` or `from "../../shared/"` patterns in server, extension, or client source
- **THEN** zero matches SHALL be found

### Requirement: ArchiveEntry type moves to shared
The `ArchiveEntry` type SHALL be defined in the shared package, not the server package.

#### Scenario: Client imports ArchiveEntry from shared
- **WHEN** the client needs the `ArchiveEntry` type
- **THEN** it SHALL import from `@blackbelt-technology/pi-dashboard-shared/archive-types.js`

### Requirement: Runtime packages are public on npm, Electron package is private

Each of the four runtime workspace packages (`shared`, `extension`, `server`, `client`/`-web`) SHALL be published to the public npm registry. The `packages/electron` workspace SHALL be marked `"private": true` and SHALL NOT be published to npm; it is distributed exclusively as platform-native installers through GitHub Releases.

#### Scenario: Runtime packages published, Electron excluded

- **WHEN** listing `@blackbelt-technology/pi-dashboard-*` packages on the npm registry after a release
- **THEN** `shared`, `extension`, `server`, and `web` SHALL each have a published version
- **AND** `electron` SHALL NOT be present on the registry

#### Scenario: Electron workspace declares private

- **WHEN** reading `packages/electron/package.json`
- **THEN** `"private": true` SHALL be set at the top level

### Requirement: Cross-package dependency specifiers use plain semver ranges

All cross-package dependency entries in every workspace `package.json` (including the root) SHALL use plain semver caret ranges (e.g. `"^0.3.0"`). The `workspace:` protocol (any variant) is NOT supported by the npm CLI and MUST NOT be used. Lockstep version consistency across the monorepo is maintained by `scripts/sync-versions.js` at release time.

#### Scenario: No workspace: protocol specifiers exist

- **WHEN** scanning all `package.json` files in the repository for inter-package dependencies within the `@blackbelt-technology/pi-dashboard-*` scope
- **THEN** every such entry SHALL match a plain semver caret range pattern (`^<digits>.<digits>.<digits>`)
- **AND** no entry SHALL contain the string `"workspace:"`

#### Scenario: Development install symlinks local workspaces

- **WHEN** running `rm -rf node_modules package-lock.json && npm install` from the repository root with plain-semver specifiers in place
- **THEN** the install SHALL succeed without `EUNSUPPORTEDPROTOCOL` errors
- **AND** `node_modules/@blackbelt-technology/pi-dashboard-shared` SHALL be a symlink to `packages/shared`
- **AND** the server, extension, and client workspaces SHALL similarly symlink to their local copies
