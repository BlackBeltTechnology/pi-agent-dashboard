## MODIFIED Requirements

### Requirement: Package-manager role split
`pnpm` SHALL be the package manager for all development, CI, and build tasks.
`npm` SHALL survive only as (a) the `npm publish --provenance` command in the
release workflow (preserving OIDC Trusted Publishing, which does not require an
npm-installed tree) and (b) runtime `npm install` invocations that run on
END-USER machines (`pi-core-updater`, `recovery-server`, `pi-core-checker`,
electron `update-checker`), and (c) assembling the npm-layout runtime tree that ships
to end users: `npm install`, `npm pack` and `npm ci` inside the Electron bundle step
(`bundle-server.mjs`), and `npm install --package-lock-only` in runtime-lock generation.
These npm survivors SHALL NOT be rewritten to pnpm. A transient `package-lock.json` that
the bundle step writes into its gitignored build output and removes again is not a
repository lockfile.

#### Scenario: publish uses pnpm install + npm publish
- **WHEN** the release workflow runs
- **THEN** dependencies SHALL be installed with `pnpm install --frozen-lockfile`
  and packages SHALL be published with `npm publish --provenance` (OIDC intact)

#### Scenario: runtime installs stay npm
- **WHEN** the shipped server or electron app installs/updates pi-core on a user machine
- **THEN** it SHALL invoke `npm install`, never `pnpm`

#### Scenario: bundle assembly stays npm
- **WHEN** the Electron bundle step installs the bundled server's dependencies
- **THEN** it SHALL use `npm` (`npm install`, or `npm pack` + `npm ci` for a release-lock build), never `pnpm`
- **AND** no `package-lock.json` SHALL remain in the bundle output or be committed to the repository
