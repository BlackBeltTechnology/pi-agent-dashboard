# bootstrap-install

## Purpose

Requirements governing how the PI Dashboard bootstraps its runtime dependencies (`pi-coding-agent`, `openspec`, `tsx`, and the dashboard server) on first launch across delivery channels (npm CLI, Electron installers per platform). Covers both online and offline first-run flows, integrity verification, and diagnostic surfacing.

## Requirements

### Requirement: Electron artifacts ship a per-platform offline npm cache

Every published Electron artifact (DMG, DEB, AppImage, NSIS, ZIP / portable) SHALL include a `resources/offline-packages/` directory containing a `manifest.json` and a `npm-cache.tar.gz` gzip of a pre-populated npm `_cacache/` tree targeted at that artifact's platform. The cache SHALL contain every tarball required to install `@mariozechner/pi-coding-agent`, `@fission-ai/openspec`, and `tsx` at their pinned versions without any network access.

#### Scenario: Manifest and cache present in packaged ZIP

- **WHEN** a user unzips the Windows portable ZIP
- **THEN** `<app>/resources/offline-packages/manifest.json` exists
- **AND** `<app>/resources/offline-packages/npm-cache.tar.gz` exists
- **AND** `manifest.json.targetPlatform` equals `"win32-x64"`

#### Scenario: Cache integrity declared

- **WHEN** the build script produces the cache tarball
- **THEN** `manifest.json.sha256` matches the SHA-256 of the tarball content

#### Scenario: Per-platform payloads

- **WHEN** the macOS arm64 DMG and the Windows x64 NSIS are both inspected
- **THEN** each contains a `manifest.json` whose `targetPlatform` matches the artifact's platform
- **AND** neither ships the other platform's cache

### Requirement: First-run installer uses bundled cache with --offline

When `resources/offline-packages/manifest.json` is present, the first-run installer SHALL extract `npm-cache.tar.gz` into the managed install directory and invoke `npm install --offline --cache <extracted>` to install the three pinned packages. The installer SHALL NOT contact the npm registry for these packages or their transitive dependencies on first run.

#### Scenario: Offline cache present, network available

- **WHEN** the Electron app runs its first-run installer on a machine with network access
- **AND** the offline manifest is present
- **THEN** the installer extracts `npm-cache.tar.gz` to `<managedDir>/.offline-cache/`
- **AND** verifies the tarball SHA-256 against `manifest.sha256` BEFORE extraction
- **AND** invokes `npm install --offline --cache <managedDir>/.offline-cache` with the three pinned `name@version` pairs
- **AND** issues zero network requests to the npm registry

#### Scenario: Offline cache present, air-gapped

- **WHEN** the Electron app runs on a machine with no internet access
- **AND** the offline manifest is present
- **THEN** installation succeeds with no registry contact

#### Scenario: Cache integrity mismatch

- **WHEN** the tarball SHA-256 does not match `manifest.sha256`
- **THEN** the installer aborts with an integrity error
- **AND** does NOT fall back to the registry
- **AND** does NOT extract the tarball

#### Scenario: Cache install failure does not fall back

- **WHEN** `npm install --offline` exits non-zero
- **THEN** the installer reports the failure through the progress callback with `status: "error"`
- **AND** does NOT retry with registry access on the same run
- **AND** preserves `<managedDir>/.offline-cache/` for debugging

#### Scenario: Cache cleanup on success

- **WHEN** `npm install --offline` exits zero
- **THEN** the installer deletes `<managedDir>/.offline-cache/` to reclaim disk space
- **AND** the source `resources/offline-packages/npm-cache.tar.gz` remains untouched

#### Scenario: Manifest absent

- **WHEN** the offline manifest is NOT present (dev build without the bundle step)
- **THEN** the installer falls back to today's registry-based per-package install loop unchanged

### Requirement: Doctor surfaces bundle state

The Electron Doctor diagnostic SHALL include a row showing whether the offline bundle is present and, if so, the target platform and versions of the three bundled packages.

#### Scenario: Bundle present

- **WHEN** the user opens Doctor in a build that shipped with the bundle
- **THEN** the "Offline packages bundle" row shows a check mark
- **AND** displays `manifest.targetPlatform`
- **AND** lists the three pinned packages with versions

#### Scenario: Bundle absent

- **WHEN** the user opens Doctor in a dev build without the bundle
- **THEN** the row shows "Not bundled (registry-install mode)"
- **AND** does NOT fail or block any other diagnostic
