# workspace-publishing

## Purpose

Requirements governing how the PI Dashboard monorepo publishes its workspace packages to the public npm registry: which workspaces are published, the cross-package dependency specifier convention, the publish command, lockstep versioning, and which workspaces are deliberately private.
## Requirements
### Requirement: Runtime workspaces are published to the public npm registry

Every runtime workspace under `packages/` — specifically `shared`, `extension`, `server`, and `client` (published as `-web`) — SHALL be published to the public npm registry under the `@blackbelt-technology/pi-dashboard-*` scope on every tagged release.

Beyond those four, **every workspace under `packages/` that does not declare `"private": true` SHALL be published** on every tagged release. The distinction between "runtime workspace" and "other published workspace" governs naming and release ordering only; it does not exempt any non-private workspace from publication.

#### Scenario: All runtime workspace names resolve on registry after release

- **WHEN** a tagged release completes for `<version>`
- **THEN** `npm view @blackbelt-technology/pi-dashboard-shared version` SHALL return `<version>`
- **AND** `npm view @blackbelt-technology/pi-dashboard-extension version` SHALL return `<version>`
- **AND** `npm view @blackbelt-technology/pi-dashboard-server version` SHALL return `<version>`

#### Scenario: Fresh install of the root metapackage succeeds

- **WHEN** installing `@blackbelt-technology/pi-agent-dashboard@<version>` into an empty directory
- **THEN** the install SHALL succeed
- **AND** `node_modules/@blackbelt-technology/pi-dashboard-shared/` SHALL exist
- **AND** `node_modules/@blackbelt-technology/pi-dashboard-extension/` SHALL exist
- **AND** `node_modules/@blackbelt-technology/pi-dashboard-server/` SHALL exist

#### Scenario: Every non-private workspace resolves on the registry after release

- **WHEN** enumerating every `packages/*/package.json` without `"private": true` after a tagged release for `<version>`
- **THEN** `npm view <name> version` SHALL return `<version>` for each

#### Scenario: Publish dry-run lists every non-private workspace before merge

- **WHEN** running `npm publish --workspaces --include-workspace-root --dry-run` on a pull request
- **THEN** the output SHALL include one entry per workspace under `packages/` that does not declare `"private": true`
- **AND** SHALL include no entry for a workspace that declares `"private": true`

### Requirement: Cross-workspace dependencies use plain semver ranges

Every `dependencies` entry in any workspace's `package.json` that references another package in the same monorepo SHALL use a plain semver caret range (e.g. `"^0.3.0"`), not the `workspace:` protocol. The npm CLI does not implement the `workspace:` protocol and rejects all variants (`workspace:*`, `workspace:^`, `workspace:~`, `workspace:<ver>`) with `EUNSUPPORTEDPROTOCOL` on fresh installs; plain semver is the only specifier form that works on both development installs (via workspace symlink resolution) and published tarballs.

#### Scenario: No workspace: protocol specifiers exist

- **WHEN** grepping any `package.json` in the repository for the literal string `"workspace:"`
- **THEN** zero matches SHALL be found in any `dependencies`, `devDependencies`, or `peerDependencies` block

#### Scenario: Root package cross-refs use plain semver

- **WHEN** reading the root `package.json` `dependencies` field
- **THEN** `@blackbelt-technology/pi-dashboard-extension` SHALL match the pattern `^<digits>.<digits>.<digits>`
- **AND** `@blackbelt-technology/pi-dashboard-server` SHALL match the same pattern
- **AND** `@blackbelt-technology/pi-dashboard-web` SHALL match the same pattern

#### Scenario: Server package cross-refs use plain semver

- **WHEN** reading `packages/server/package.json`
- **THEN** `@blackbelt-technology/pi-dashboard-shared` SHALL match the pattern `^<digits>.<digits>.<digits>`
- **AND** `@blackbelt-technology/pi-dashboard-extension` SHALL match the same pattern

#### Scenario: Extension, client, and electron cross-refs use plain semver

- **WHEN** reading `packages/extension/package.json`, `packages/client/package.json`, and `packages/electron/package.json`
- **THEN** each `@blackbelt-technology/pi-dashboard-shared` entry SHALL match the pattern `^<digits>.<digits>.<digits>`

#### Scenario: Local development install symlinks workspaces

- **WHEN** running `rm -rf node_modules package-lock.json && npm install` at the repo root
- **THEN** the install SHALL complete successfully
- **AND** `node_modules/@blackbelt-technology/pi-dashboard-shared` SHALL be a symlink to `packages/shared`
- **AND** the server, extension, and client workspaces SHALL similarly symlink to their local copies

### Requirement: A sync-versions script keeps inter-package dep specifiers aligned

The repository SHALL provide a `scripts/sync-versions.js` helper that, given a lockstep-bumped monorepo, rewrites every inter-package dependency specifier in every workspace `package.json` to `^<current-version>`. It SHALL be invoked as part of any version bump in the release flow, after `npm version -ws --include-workspace-root`.

#### Scenario: Script exists and is executable

- **WHEN** listing `scripts/sync-versions.js`
- **THEN** the file SHALL exist
- **AND** it SHALL be a valid Node.js ES module or CommonJS script with no runtime dependencies beyond Node built-ins

#### Scenario: Script verifies lockstep versioning

- **WHEN** the script is invoked while any `packages/*/package.json` version differs from the root `package.json` version
- **THEN** the script SHALL exit non-zero with an error indicating lockstep violation
- **AND** no `package.json` file SHALL be modified

#### Scenario: Script rewrites inter-package dep specifiers

- **WHEN** every workspace and the root share version `X.Y.Z` and the script is invoked
- **THEN** every `dependencies` or `devDependencies` entry whose name matches a known `@blackbelt-technology/pi-dashboard-*` workspace SHALL be rewritten to `^X.Y.Z`
- **AND** no other fields in any `package.json` SHALL be modified

#### Scenario: Script is a no-op when already in sync

- **WHEN** the script is invoked after a fresh bump + sync, with no intermediate changes
- **THEN** the script SHALL exit zero
- **AND** no files SHALL be written

### Requirement: Published tarballs contain resolvable concrete semver dependencies

Every published tarball's `package.json` `dependencies` field SHALL contain concrete semver ranges matching the current release's version. No `dependencies` value SHALL be `"*"`, the empty string, or any `workspace:` protocol specifier.

Additionally, **every non-private workspace under `packages/` SHALL declare every package its shipped code imports**, in one of `dependencies`, `peerDependencies`, or `optionalDependencies`. A workspace SHALL NOT rely on monorepo hoisting to resolve an import that its own manifest does not declare, because hoisting does not exist in a consumer's install.

A `devDependency` SHALL NOT satisfy an import in a shipped file, because dev dependencies are not installed for consumers. A package imported only by files outside the packed file set MAY be a `devDependency`.

Declared ranges SHALL be concrete. A range of `"*"` SHALL NOT be used for any dependency in any field of a non-private workspace, including optional peer dependencies. This applies to the root metapackage as well as to every non-private workspace under `packages/`.

A concrete range for an optional, host-provided peer SHALL NOT be assumed to be a caret range. Where an existing `"*"` is replaced, a lower-bound range (`>=<resolving-version>`) SHALL be preferred over a caret, because a caret narrows which host versions satisfy the peer and would break already-published consumers that a `"*"` previously admitted. Concreteness is the requirement; tightening is not.

A dependency that is host-provided and imported through a guarded dynamic import SHALL be declared as a `peerDependency` with `peerDependenciesMeta.<name>.optional: true` and a concrete range — optionality is expressed by the metadata, not by a wildcard range.

#### Scenario: Published root metapackage has correct deps

- **WHEN** running `npm view @blackbelt-technology/pi-agent-dashboard@<version> dependencies`
- **THEN** `@blackbelt-technology/pi-dashboard-extension` SHALL match the pattern `^<version>`
- **AND** `@blackbelt-technology/pi-dashboard-server` SHALL match the pattern `^<version>`
- **AND** `@blackbelt-technology/pi-dashboard-web` SHALL match the pattern `^<version>`
- **AND** no value SHALL be `"*"` or contain `"workspace:"`

#### Scenario: Dry-run output shows no workspace protocol strings

- **WHEN** running `npm publish --workspaces --include-workspace-root --dry-run` locally
- **THEN** the dry-run output for each workspace SHALL NOT contain the string `"workspace:"`

#### Scenario: Every non-private workspace declares what its shipped code imports

- **WHEN** the publish-correctness check runs across every workspace under `packages/` that does not declare `"private": true`
- **THEN** for each such workspace, every non-builtin module specifier in its packed file set SHALL resolve to a `dependencies`, `peerDependencies`, or `optionalDependencies` entry in that workspace's own `package.json`
- **AND** the check SHALL exit zero

#### Scenario: A shipped file may not rely on a devDependency

- **WHEN** a shipped file in a non-private workspace imports a package declared only in that workspace's `devDependencies`
- **THEN** the publish-correctness check SHALL exit non-zero

#### Scenario: No wildcard ranges in non-private workspaces

- **WHEN** reading the `dependencies`, `devDependencies`, `peerDependencies`, and `optionalDependencies` of the root metapackage and of every non-private workspace under `packages/`
- **THEN** no declared range SHALL be `"*"`

#### Scenario: De-wildcarding an optional peer does not tighten it

- **WHEN** an existing `"*"` range on a host-provided optional peer is replaced with a concrete range
- **THEN** the replacement SHALL be a lower-bound range satisfied by the resolving version
- **AND** it SHALL NOT be a caret range, which would exclude older hosts the `"*"` admitted

#### Scenario: Optional host-provided dependencies are concrete optional peers

- **WHEN** a workspace imports a host-provided package through a guarded dynamic import, as `packages/extension` does for `@earendil-works/pi-ai`
- **THEN** that package SHALL appear in `peerDependencies` with a concrete range
- **AND** `peerDependenciesMeta.<name>.optional` SHALL be `true`

### Requirement: The Electron workspace is private and not published to npm

`packages/electron` SHALL declare `"private": true` in its `package.json` so that `npm publish --workspaces` automatically skips it. The Electron package ships as native installers (DMG, DEB, AppImage, EXE) attached to the GitHub Release, never as an npm tarball.

#### Scenario: Electron package is marked private

- **WHEN** reading `packages/electron/package.json`
- **THEN** the top-level `"private"` field SHALL be `true`

#### Scenario: Electron package is absent from npm registry after release

- **WHEN** running `npm view @blackbelt-technology/pi-dashboard-electron` after a release
- **THEN** npm SHALL return a 404 / "not found" response
- **AND** no version of the package SHALL be present on the registry

#### Scenario: Electron build pipeline still works

- **WHEN** running `npm run electron:make` after the private marker is added
- **THEN** the Electron Forge build SHALL complete and produce platform-native installers in `packages/electron/out/`

### Requirement: Each published workspace declares public access

Every workspace that is published to npm SHALL declare `"publishConfig": { "access": "public" }` in its `package.json`. This is required because `npm publish --workspaces` iterates per-workspace and consults each workspace's own `publishConfig` (the top-level `--access` CLI flag does not propagate).

This requirement applies to the root metapackage and to **every** workspace under `packages/` that does not declare `"private": true` — not to an enumerated subset. Membership is a computable predicate over the workspace set, so a newly-added published workspace is covered automatically rather than requiring a spec edit.

#### Scenario: Root has public publishConfig

- **WHEN** reading the root `package.json`
- **THEN** `publishConfig.access` SHALL be `"public"`

#### Scenario: Shared has public publishConfig

- **WHEN** reading `packages/shared/package.json`
- **THEN** `publishConfig.access` SHALL be `"public"`

#### Scenario: Extension has public publishConfig

- **WHEN** reading `packages/extension/package.json`
- **THEN** `publishConfig.access` SHALL be `"public"`

#### Scenario: Server has public publishConfig

- **WHEN** reading `packages/server/package.json`
- **THEN** `publishConfig.access` SHALL be `"public"`

#### Scenario: Client has public publishConfig

- **WHEN** reading `packages/client/package.json`
- **THEN** `publishConfig.access` SHALL be `"public"`

#### Scenario: Every non-private workspace has public publishConfig

- **WHEN** enumerating every `packages/*/package.json` that does not declare `"private": true`
- **THEN** each one SHALL declare `publishConfig.access` equal to `"public"`

#### Scenario: A newly-added published workspace is covered without a spec change

- **WHEN** a new workspace is added under `packages/` without `"private": true`
- **THEN** the preceding scenario SHALL apply to it with no edit to this specification

### Requirement: Release workflow publishes all workspaces with provenance

The GitHub Actions `publish` job in `.github/workflows/publish.yml` SHALL publish all non-private workspaces and the root in a single invocation, with npm provenance attestation.

#### Scenario: Publish command uses --workspaces --include-workspace-root

- **WHEN** reading `.github/workflows/publish.yml`
- **THEN** the publish step SHALL invoke `npm publish` with flags `--workspaces --include-workspace-root --provenance --access public`

#### Scenario: Provenance attestation exists for each published package

- **WHEN** running `npm view @blackbelt-technology/pi-dashboard-<name>@<version>` for any published workspace after a tag release
- **THEN** the registry metadata SHALL include a `dist.attestations` field referencing the corresponding GitHub Actions workflow run

### Requirement: Lockstep versioning across published workspaces

All published workspaces and the root SHALL share one version number, bumped atomically at release time and kept in sync by `scripts/sync-versions.js` as a post-bump step.

#### Scenario: All versions match after release

- **WHEN** comparing `version` fields in the root `package.json` and every `packages/*/package.json`
- **THEN** every `version` field SHALL contain the identical string

#### Scenario: Registry versions match across the package set

- **WHEN** querying `npm view @blackbelt-technology/pi-<name> version` for root + 4 runtime packages after a tagged release
- **THEN** all five SHALL return the same version string

