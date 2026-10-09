# electron-runtime-release Specification

## Purpose
Producer side of Electron runtime overlay updates: every release X publishes an installable runtime (a `runtime-lock.json` inside the server package plus per-platform GitHub assets with `.sha512`). The release is blocked while any bundled plugin is missing at X, and prereleases use the npm `beta` channel. Consumer behaviour lives in `electron-runtime-overlay`.

## Requirements

### Requirement: Release ships a runtime lock

Every release X SHALL publish `runtime-lock.json` inside `@blackbelt-technology/pi-dashboard-server@X`, pinning the runtime package set and every `piDashboard.bundledPlugins` package at exactly X.

#### Scenario: Lock lists every bundled plugin
- **WHEN** release X is published
- **THEN** `runtime-lock.json` in the server tarball lists each `bundledPlugins` package at version X
- **AND** the file is not named `npm-shrinkwrap.json`

### Requirement: Unpublished bundled plugin blocks the release

The release SHALL fail before lock-dependent artifacts are published or dist-tags move when any `bundledPlugins` package does not resolve on the registry at X.

#### Scenario: Missing plugin
- **WHEN** one `bundledPlugins` package is absent from the registry at X after retries
- **THEN** the release fails naming that package
- **AND** no GitHub runtime asset is attached for X

### Requirement: Prereleases use the beta channel

Prerelease versions SHALL publish under the npm `beta` dist-tag and as GitHub prereleases, with the runtime asset and its `.sha512` attached.

#### Scenario: Prerelease tag
- **WHEN** the release workflow runs on a prerelease tag X
- **THEN** `npm dist-tag ls` shows `beta` = X
- **AND** the GitHub prerelease `vX` carries the runtime asset + `.sha512`
- **AND** the asset's runtime manifest version equals X
