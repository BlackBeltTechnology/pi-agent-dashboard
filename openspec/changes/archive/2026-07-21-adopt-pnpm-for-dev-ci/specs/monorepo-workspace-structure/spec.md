# monorepo-workspace-structure — delta

## MODIFIED Requirements

### Requirement: npm workspace layout
The project SHALL be structured as a **pnpm workspaces** monorepo (packages
enumerated in `pnpm-workspace.yaml` `packages: ['packages/*']`), with `pnpm`
pinned via the root `package.json` `packageManager` field and `pnpm-lock.yaml`
as the single committed lockfile. `package-lock.json` SHALL NOT be committed.
The workspace SHALL set `nodeLinker: hoisted` (required by electron-forge and
resolving third-party phantom dependencies).

#### Scenario: pnpm install links workspace packages
- **WHEN** running `pnpm install` from the root
- **THEN** local `@blackbelt-technology/*` packages SHALL be linked from the
  workspace (via `linkWorkspacePackages: true`), not fetched from the registry,
  even when the local version is ahead of the published version

#### Scenario: single lockfile
- **WHEN** the repository is checked out
- **THEN** `pnpm-lock.yaml` SHALL be present and `package-lock.json` SHALL be absent

## ADDED Requirements

### Requirement: Package-manager role split
`pnpm` SHALL be the package manager for all development, CI, and build tasks.
`npm` SHALL survive only as (a) the `npm publish --provenance` command in the
release workflow (preserving OIDC Trusted Publishing, which does not require an
npm-installed tree) and (b) runtime `npm install` invocations that run on
END-USER machines (`pi-core-updater`, `recovery-server`, `pi-core-checker`,
electron `update-checker`). These npm survivors SHALL NOT be rewritten to pnpm.

#### Scenario: publish uses pnpm install + npm publish
- **WHEN** the release workflow runs
- **THEN** dependencies SHALL be installed with `pnpm install --frozen-lockfile`
  and packages SHALL be published with `npm publish --provenance` (OIDC intact)

#### Scenario: runtime installs stay npm
- **WHEN** the shipped server or electron app installs/updates pi-core on a user machine
- **THEN** it SHALL invoke `npm install`, never `pnpm`

### Requirement: Electron build compatibility under pnpm
The electron build SHALL succeed under pnpm. `bundle-server.mjs` SHALL exclude
`node_modules` when copying workspace packages into the server bundle (pnpm's
per-package `node_modules` are store symlinks that otherwise break the bundle's
node-pty prebuilds). The electron packaging SHALL run with `nodeLinker: hoisted`.

#### Scenario: bundled node-pty carries all prebuilds
- **WHEN** `bundle-server.mjs` runs under pnpm
- **THEN** `resources/server/node_modules/node-pty/prebuilds` SHALL contain all
  required platform triples and the GO/NO-GO guard SHALL pass

#### Scenario: electron-forge packages the app
- **WHEN** `electron-forge package` runs under pnpm with `nodeLinker: hoisted`
- **THEN** it SHALL produce a `.app` containing the server bundle with node-pty prebuilds
