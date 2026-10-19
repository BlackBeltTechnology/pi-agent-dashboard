## MODIFIED Requirements

### Requirement: Provisioning report
Each CLI provisioning run SHALL be able to report one JSON object with `app`, `version`, `source` (`override`, `pin`, `latest`, `latest-cached`, `fallback-installed`, `launcher`), `asset` (`null` for override/launcher), `cacheHit`, `binary` (absolute path), `durationMs`, and on macOS managed installs `gatekeeper` (assessment result; a rejection warns but does not fail). A web build provisioning run SHALL report `app`, `version` (or the override key), `source` (`override`, `pin`, `registry`, `latest`, `latest-cached`, `fallback-installed`), `asset` (`null` for override), `cacheHit`, `dir` (absolute path of the installed build), `shimVersion` and `durationMs`.

#### Scenario: Fresh install report
- **WHEN** `soundcraft` `0.6.1` is installed on an empty cache
- **THEN** the report contains `app: "soundcraft"`, `version: "0.6.1"`, `source: "latest"`, the asset name, `cacheHit: false`, an absolute binary path and a duration

#### Scenario: Web build report
- **WHEN** the `wordcraft` web build `0.8.0` is installed from the registry version on an empty cache
- **THEN** the report contains `app: "wordcraft"`, `version: "0.8.0"`, `source: "registry"`, `asset: "wordcraft-web-0.8.0.zip"`, `cacheHit: false`, an absolute `dir`, the shim version and a duration

### Requirement: Web build provisioning
The provisioner SHALL provision an app's static web build (`<app>-web-<ver>.zip`) on request, separately from its CLI.

**Version resolution**, in precedence order:
1. A directory override `<APP>_WEB_DIR`, whose contents are installed into the web cache with no download; the override directory itself SHALL NOT be modified.
2. A version pin `<APP>_WEB_VERSION` whose value is not `latest`.
3. When the latest channel is selected — by `<APP>_WEB_VERSION=latest` (case-insensitive) or by the caller's channel option — the app repository's latest release, if it publishes `<app>-web-<ver>.zip`.
4. The registry's verified web version for that app.

The pinned channel SHALL be the default; without an explicit latest selection the provisioner SHALL NOT use the latest release. The latest-release lookup SHALL be cached per app for 24 hours under the web root, and a release without the web asset SHALL NOT be cached. When the latest lookup fails or the latest release has no web asset, the provisioner SHALL use the newest installed web build prepared with the current shim version, else the registry's verified web version, and SHALL log a warning. `<APP>_BIN` and `<APP>_VERSION` SHALL NOT affect web build resolution. An app with no verified web version, no override and no resolvable latest build SHALL be rejected with a reason.

The provisioner SHALL expose a metadata-only latest lookup that returns the latest web version (from cache or network) without downloading any build.

**Source selection.** With `CRAFT_SOURCE=launcher`, web build provisioning SHALL fail without any network request unless `<APP>_WEB_DIR` is set.

**Download and extraction.**
- The asset SHALL be checksum-verified under the same fail-closed rules as CLI assets.
- Archive entries SHALL be listed and checked under the same safety rules before extraction.
- Extraction SHALL work on every supported host OS, Linux included.
- The build SHALL be installed into `<web root>/<app>-web/<key>/` and moved into place atomically, where `<key>` is the version, or for a directory override a digest of the whole override tree (every file path and content), so a changed override is never mistaken for a cached one. `<web root>` is the caller-supplied root, defaulting to the cache root; either way the tree is disjoint from the CLI cache.
- After install the provisioner SHALL point `<web root>/<app>-web/current` at the installed tree, so a consumer can serve one stable location. The switch SHALL be atomic where the OS supports it; on Windows a brief window in which the location is unavailable is permitted, never one in which it points at a partial tree.
- The installed tree SHALL record the host-shim version it was prepared with; a tree prepared with a different shim version SHALL be treated as not installed and prepared again.
- The installed tree SHALL contain the build's `index.html`.
- Concurrent requests for the same app and version, in one process or several, SHALL yield one install; stale web staging directories older than one hour SHALL be removed.
- Provisioning a web build SHALL NOT create, modify or delete anything under the CLI cache `<cache root>/<app>/`.

#### Scenario: Web and CLI caches coexist
- **WHEN** `wordcraft` CLI `0.8.0` is cached and the `wordcraft` web build `0.8.0` is then provisioned
- **THEN** the web build lands in `<cache root>/wordcraft-web/0.8.0/` (default web root), and the CLI install at `<cache root>/wordcraft/0.8.0/` is untouched and still reported as a cache hit

#### Scenario: Pinned, never latest
- **WHEN** the registry's verified web version for `wordcraft` is `0.8.0`, a newer release exists, and neither an override nor the latest channel is selected
- **THEN** `wordcraft-web-0.8.0.zip` is provisioned and no latest-release lookup is made

#### Scenario: Latest channel
- **WHEN** the latest channel is selected for `wordcraft` and the latest release `v0.9.0` publishes `wordcraft-web-0.9.0.zip`
- **THEN** `wordcraft-web-0.9.0.zip` is provisioned with source `latest`, and a second provisioning within 24 hours reports source `latest-cached` without a latest-release lookup

#### Scenario: Latest release without a web build
- **WHEN** `WORDCRAFT_WEB_VERSION=latest` and the latest release publishes no `wordcraft-web-*.zip`
- **THEN** the registry's verified version is provisioned, a warning is logged, and the latest lookup is not cached

#### Scenario: Latest lookup offline
- **WHEN** the latest channel is selected, the latest lookup fails, and web build `0.9.0` is installed for the current shim version
- **THEN** `0.9.0` is used with source `fallback-installed` and no download is made

#### Scenario: Explicit pin beats latest channel
- **WHEN** the caller selects the latest channel and `WORDCRAFT_WEB_VERSION=0.8.0`
- **THEN** `0.8.0` is provisioned as an explicit pin and no latest-release lookup is made

#### Scenario: Air-gapped override
- **WHEN** `DECKCRAFT_WEB_DIR` points at a directory containing an `index.html`
- **THEN** its build is installed from that directory, no network request is made, and `DECKCRAFT_WEB_DIR` is left unchanged

#### Scenario: Linux host
- **WHEN** the `wordcraft` web build is provisioned on a Linux host
- **THEN** it is extracted and installed like on macOS

#### Scenario: Launcher source
- **WHEN** `CRAFT_SOURCE=launcher` and no `WORDCRAFT_WEB_DIR` is set
- **THEN** web build provisioning of `wordcraft` fails naming the launcher source, and no network request is made

#### Scenario: Checksum mismatch
- **WHEN** the downloaded `wordcraft-web-0.8.0.zip` does not match its `SHA256SUMS.txt` entry
- **THEN** provisioning fails, the download is deleted and nothing is cached

#### Scenario: Changed override is re-installed
- **WHEN** `DECKCRAFT_WEB_DIR`'s wasm file changes while its `index.html` stays identical
- **THEN** the next provisioning installs a new tree and points `current` at it

#### Scenario: Shim version change re-prepares
- **WHEN** `wordcraft` web `0.8.0` was prepared with an older shim version and the current shim version differs
- **THEN** the build is reported not installed, the next prepare installs a new tree, and the earlier tree is left unchanged
