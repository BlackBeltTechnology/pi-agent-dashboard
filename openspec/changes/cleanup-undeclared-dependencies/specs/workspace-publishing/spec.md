# workspace-publishing

## MODIFIED Requirements

### Requirement: Published tarballs contain resolvable concrete semver dependencies

Every published tarball's `package.json` `dependencies` field SHALL contain concrete semver ranges matching the current release's version. No `dependencies` value SHALL be `"*"`, the empty string, or any `workspace:` protocol specifier.

Additionally, **every non-private workspace under `packages/` SHALL declare every package its shipped code imports**, in one of `dependencies`, `peerDependencies`, or `optionalDependencies`. A workspace SHALL NOT rely on monorepo hoisting to resolve an import that its own manifest does not declare, because hoisting does not exist in a consumer's install.

A `devDependency` SHALL NOT satisfy an import in a shipped file, because dev dependencies are not installed for consumers. A package imported only by files outside the packed file set MAY be a `devDependency`.

Declared ranges SHALL be concrete. A range of `"*"` SHALL NOT be used for any dependency in any field of a non-private workspace, including optional peer dependencies.

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

- **WHEN** reading the `dependencies`, `devDependencies`, `peerDependencies`, and `optionalDependencies` of every non-private workspace under `packages/`
- **THEN** no declared range SHALL be `"*"`

#### Scenario: Optional host-provided dependencies are concrete optional peers

- **WHEN** a workspace imports a host-provided package through a guarded dynamic import, as `packages/extension` does for `@earendil-works/pi-ai`
- **THEN** that package SHALL appear in `peerDependencies` with a concrete range
- **AND** `peerDependenciesMeta.<name>.optional` SHALL be `true`

### Requirement: Each published workspace declares public access

Every workspace that is published to npm SHALL declare `"publishConfig": { "access": "public" }` in its `package.json`. This is required because `npm publish --workspaces` iterates per-workspace and consults each workspace's own `publishConfig` (the top-level `--access` CLI flag does not propagate).

This requirement applies to the root metapackage and to **every** workspace under `packages/` that does not declare `"private": true` — not to an enumerated subset. Membership is a computable predicate over the workspace set, so a newly-added published workspace is covered automatically rather than requiring a spec edit.

#### Scenario: Root has public publishConfig

- **WHEN** reading the root `package.json`
- **THEN** `publishConfig.access` SHALL be `"public"`

#### Scenario: Every non-private workspace has public publishConfig

- **WHEN** enumerating every `packages/*/package.json` that does not declare `"private": true`
- **THEN** each one SHALL declare `publishConfig.access` equal to `"public"`

#### Scenario: A newly-added published workspace is covered without a spec change

- **WHEN** a new workspace is added under `packages/` without `"private": true`
- **THEN** the preceding scenario SHALL apply to it with no edit to this specification

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
