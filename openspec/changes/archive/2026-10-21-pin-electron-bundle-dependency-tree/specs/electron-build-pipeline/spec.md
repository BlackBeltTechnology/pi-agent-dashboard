## ADDED Requirements

### Requirement: Release bundles install the published runtime lock
When the Electron app is built with a release-lock version X (release and nightly builds), the bundled server's third-party dependency tree SHALL be installed from the `runtime-lock.json` published inside `@blackbelt-technology/pi-dashboard-server@X`, every fetched tarball SHALL be verified against the lock's `integrity`, and no first-party `@blackbelt-technology/*` package SHALL be taken from the registry: first-party packages SHALL come from the bundled workspace sources at X. Builds invoked without a release-lock version SHALL keep resolving third-party dependencies from the registry at build time.

#### Scenario: Release installer pins third-party versions to the lock
- **WHEN** the bundle step runs with release-lock version X
- **THEN** every third-party package installed in the bundled server SHALL be at a version X's `runtime-lock.json` lists for that package
- **AND** every third-party lock entry that applies to the build target and is reachable from the bundle's root SHALL be installed
- **AND** each installed third-party tarball SHALL have been verified against the lock's `integrity` value

#### Scenario: First-party packages never come from the registry
- **WHEN** the bundle step runs with release-lock version X
- **THEN** every `@blackbelt-technology/*` package in the bundled server SHALL originate from a bundled workspace source or the locally built web client, and none SHALL be fetched from the registry
- **AND** a lock entry for a first-party package the bundle does not map SHALL fail the bundle step naming that package

#### Scenario: Lock entry without integrity is rejected
- **WHEN** a third-party entry in the release lock carries no `integrity` value
- **THEN** the bundle step SHALL exit non-zero naming the entry instead of installing it unverified

#### Scenario: Missing release lock fails the build
- **WHEN** the bundle step runs with release-lock version X and `server@X` cannot be fetched from the configured registry, or its tarball contains no `runtime-lock.json`
- **THEN** the bundle step SHALL exit non-zero with an error naming X and the missing artifact
- **AND** it SHALL NOT fall back to resolving dependencies from ranges

#### Scenario: Lock for another version is rejected
- **WHEN** the release lock's root version, or the bundled server workspace's version, differs from the release-lock version X
- **THEN** the bundle step SHALL exit non-zero naming the versions involved

#### Scenario: Misused release-lock input fails instead of floating
- **WHEN** the bundle step is given an empty release-lock version, or a release-lock version together with source-only mode
- **THEN** it SHALL exit non-zero before installing anything

#### Scenario: Builds without a release-lock version keep the floating install
- **WHEN** the bundle step runs without a release-lock version (PR, develop and on-demand electron builds)
- **THEN** it SHALL install third-party dependencies from the registry ranges as before, without fetching any release lock

#### Scenario: Release builds prove they used the lock
- **WHEN** a build with release-lock enabled for version X completes its bundle step
- **THEN** the bundled `runtime-manifest.json` SHALL record `installMode: "release-lock"` and `lockVersion: X`
- **AND** the build SHALL fail if either value is missing or different, regardless of what the release-lock version resolved to

#### Scenario: Lock defects stop the release before the server is published
- **WHEN** the release workflow generates X's runtime lock and the lock contains an unmapped first-party entry, a third-party entry without `integrity` (other than one bundled inside its parent package) or with a non-`https` source (loopback `http`, used by the nightly's Verdaccio, is accepted), or a plugin-union mismatch with the bundled workspaces
- **THEN** the workflow SHALL fail before publishing `@blackbelt-technology/pi-dashboard-server@X`
