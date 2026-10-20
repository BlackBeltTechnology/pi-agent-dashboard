# craft-binary-provisioning Specification

## Purpose
Provision the headless command-line binary of any ArtCraft Crafting App (`<app>-cli`) for the host platform on demand — from the app's upstream GitHub release (managed source) or from an existing ArtCraft Craft Launcher installation (launcher source) — with fail-closed checksum verification, safe extraction into a per-app versioned cache, and a structured report, without installing or launching any desktop application unless explicitly asked.

## Requirements

### Requirement: Supported apps
The provisioner SHALL support exactly the apps in the craft app registry: `photocraft`, `vectorcraft`, `filmcraft`, `lightcraft`, `pdfcraft`, `effectcraft`, `designcraft`, `figcraft`, `wordcraft`, `soundcraft`, `deckcraft`, `cadcraft`, `gridcraft`, each mapped to its upstream repository `storytold/<app>` and CLI binary `<app>-cli` (`<app>-cli.exe` on Windows). Any other app id SHALL be rejected with an error listing the supported ids.

#### Scenario: Unknown app id
- **WHEN** provisioning is requested for `paintcraft`
- **THEN** it fails without any network request and the error lists the 13 supported app ids

### Requirement: Per-app release version resolution
For each app, CLI provisioning SHALL resolve the release from, in precedence order:
1. a binary override `<APP>_BIN`;
2. a version pin `<APP>_VERSION` (where `<APP>` is the upper-cased app id, e.g. `FILMCRAFT_BIN`);
3. the app repository's latest non-prerelease release.

Web build provisioning follows its own resolution (see "Web build provisioning").

Versions SHALL be normalised by stripping one leading `v`. The latest-release lookup SHALL be cached per app for 24 hours; an unreadable or future-dated cache record SHALL be ignored and refetched. `GITHUB_TOKEN`, when set, SHALL be sent as the API bearer credential.

When the lookup fails:
- if at least one version of that app is installed, the highest installed version SHALL be used with a stderr warning;
- if none is installed, provisioning SHALL fail naming the HTTP status or network error and suggesting `GITHUB_TOKEN`, `<APP>_VERSION` or `<APP>_BIN`.

#### Scenario: Override bypasses provisioning
- **WHEN** `SOUNDCRAFT_BIN` points at an existing executable file
- **THEN** that path is returned for `soundcraft`, no network request is made and the cache is not touched

#### Scenario: Missing override does not fall back
- **WHEN** `FILMCRAFT_BIN` is set to a path that does not exist
- **THEN** provisioning of `filmcraft` fails naming `FILMCRAFT_BIN` and the path, and nothing is downloaded

#### Scenario: Pins are per app
- **WHEN** `EFFECTCRAFT_VERSION=0.9.2` is set and `soundcraft` is provisioned
- **THEN** `soundcraft` resolves its own latest release and `effectcraft`'s pin is not applied to it

#### Scenario: Offline with an installed version
- **WHEN** the latest-release query for `vectorcraft` fails and versions `0.10.0` and `0.11.0` are cached
- **THEN** `0.11.0` is used with report `source: "fallback-installed"` and a stderr warning

### Requirement: Host platform to release asset mapping
For CLI provisioning, the provisioner SHALL map host OS and architecture to exactly one release asset per app: when the release contains a CLI-only asset for the host (`<app>-cli-<ver>-<host>.<ext>`) it SHALL be used; otherwise the portable archive (`<app>-<ver>-linux-<arch>.tar.gz`, `<app>-<ver>-freebsd-x86_64.tar.gz`, `<app>-<ver>-windows-<arch>-portable.zip`). On Linux it SHALL first enforce the app's minimum glibc version from the registry. Unsupported hosts SHALL fail naming the OS, the architecture and `<APP>_BIN`. Web build provisioning uses one host-independent asset and performs no host mapping or glibc check (see "Web build provisioning").

#### Scenario: macOS uses the CLI zip
- **WHEN** the host is darwin/arm64 and `filmcraft` `0.7.2` is provisioned
- **THEN** the asset is `filmcraft-cli-0.7.2-macos-universal.zip`

#### Scenario: Linux prefers a CLI-only tarball when published
- **WHEN** the host is linux/x64 and the `pdfcraft` `0.8.0` release contains `pdfcraft-cli-0.8.0-linux-x86_64.tar.gz`
- **THEN** that asset is used instead of `pdfcraft-0.8.0-linux-x86_64.tar.gz`

#### Scenario: Linux falls back to the portable tarball
- **WHEN** the host is linux/arm64 and the `soundcraft` release has no Linux CLI-only asset
- **THEN** the asset is `soundcraft-<ver>-linux-aarch64.tar.gz` and the binary is taken from its `bin/` directory

### Requirement: Checksum verification fails closed
The provisioner SHALL download the release's `SHA256SUMS.txt` and SHALL refuse to extract or use an asset unless the file contains exactly one entry for it whose SHA-256 matches the downloaded bytes (64-hex digest, optional `*` marker, leading `./` ignored, CRLF tolerated). On mismatch the download SHALL be deleted and nothing written to the version cache.

#### Scenario: Digest mismatch
- **WHEN** the computed digest of `gridcraft-cli-0.7.0-macos-universal.zip` differs from the listed one
- **THEN** provisioning fails showing expected and actual digests and `<cache>/gridcraft/0.7.0/` does not exist

#### Scenario: Sums file absent
- **WHEN** the release has no `SHA256SUMS.txt`
- **THEN** provisioning fails and nothing is written to the version cache

### Requirement: Extraction into a per-app versioned cache
For CLI provisioning, the provisioner SHALL list archive entries before extracting and abort on absolute paths, `..` segments, symbolic/hard links or special files; extract into a staging directory; locate the CLI at the registry-known location for the asset kind, else as the single file with the CLI basename outside `__MACOSX`; and atomically move the tree to `<cache root>/<app>/<version>/`. The cache root SHALL be `CRAFT_HOME` or, by default, `<pi agent dir>/tools` (pi agent dir = `PI_CODING_AGENT_DIR` or `~/.pi/agent`). For `photocraft`, `PHOTOCRAFT_HOME`, when set, SHALL be used as the per-app directory. Desktop executables in the extracted tree SHALL be deleted; only the CLI is executed. Concurrent provisioning of the same app version SHALL yield one complete install; stale staging directories older than one hour SHALL be removed. Web builds use their own disjoint cache tree (see "Web build provisioning").

#### Scenario: Existing PhotoCraft cache is reused
- **WHEN** `<pi agent dir>/tools/photocraft/0.8.2/` holds a valid install from the previous photocraft package and `PHOTOCRAFT_VERSION=0.8.2`
- **THEN** provisioning returns that binary with `cacheHit: true` and downloads nothing

#### Scenario: Path-traversal entry
- **WHEN** an archive entry is named `../../x`
- **THEN** the install aborts before extraction and nothing is written to the version cache

#### Scenario: Different apps do not collide
- **WHEN** `wordcraft` and `deckcraft` are provisioned concurrently
- **THEN** each ends in its own `<cache root>/<app>/<version>/` with a working binary

### Requirement: Source selection
The provisioner SHALL honour `CRAFT_SOURCE` = `managed` (default), `launcher` or `auto`:

| `CRAFT_SOURCE` | CLI behaviour |
|---|---|
| `managed` | SHALL use release provisioning. |
| `launcher` | SHALL resolve the app's CLI from an ArtCraft Craft Launcher installation, verify it runs `--version`, and SHALL NOT download anything. If the app is not installed by the launcher it SHALL fail naming the app and suggesting `pi-craft launcher install` or `CRAFT_SOURCE=managed`. |
| `auto` | SHALL try `launcher` first, then `managed`. |

A per-app override `<APP>_BIN` SHALL take precedence over every source. Web build provisioning under `launcher` SHALL also never download (see "Web build provisioning").

#### Scenario: Launcher source never downloads
- **WHEN** `CRAFT_SOURCE=launcher` and the launcher has not installed `cadcraft`
- **THEN** provisioning of `cadcraft` fails with an error naming `cadcraft`, `pi-craft launcher install` and `CRAFT_SOURCE=managed`, and no network request is made

#### Scenario: Launcher install without a CLI
- **WHEN** `CRAFT_SOURCE=launcher` and the launcher has installed `filmcraft` as a desktop app bundle that contains no `filmcraft-cli`
- **THEN** provisioning fails stating that FilmCraft is installed by the Craft Launcher but ships no `filmcraft-cli` (desktop app only), and no network request is made

#### Scenario: Auto falls back to managed
- **WHEN** `CRAFT_SOURCE=auto` and the launcher has not installed `figcraft`
- **THEN** `figcraft` is provisioned from its release with report `source` reflecting the managed resolution

### Requirement: Desktop installers only on explicit request
The provisioner SHALL never download a desktop installer format (`.dmg`, `.msi`, `.deb`, `.rpm`, `.AppImage`, `.flatpak`, `.exe` setup) and SHALL never launch a desktop app.

The one exception is the explicit `pi-craft launcher install` command, which SHALL:
1. download the Craft Launcher installer for the host from `storytold/craft-launcher`;
2. verify it against that release's `SHA256SUMS.txt` (fail closed);
3. hand it to the OS installer.

Web build archives (`<app>-web-<ver>.zip`) are static site bundles, not desktop installers, and are fetched only by web build provisioning.

#### Scenario: App provisioning fetches only CLI archives
- **WHEN** an app's CLI is provisioned with `CRAFT_SOURCE=managed`
- **THEN** the only release files requested are the mapped CLI archive and `SHA256SUMS.txt`

#### Scenario: Web build provisioning fetches only the web archive
- **WHEN** an app's web build is provisioned
- **THEN** the only release files requested are `<app>-web-<ver>.zip` and `SHA256SUMS.txt`

#### Scenario: Launcher installer is verified
- **WHEN** `pi-craft launcher install` runs on macOS and the downloaded `.dmg` digest does not match `SHA256SUMS.txt`
- **THEN** the file is deleted, nothing is opened, and the exit code is `69`

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
