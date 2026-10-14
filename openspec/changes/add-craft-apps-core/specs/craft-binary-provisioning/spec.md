## Purpose
Provision the headless command-line binary of any ArtCraft Crafting App (`<app>-cli`) for the host platform on demand — from the app's upstream GitHub release (managed source) or from an existing ArtCraft Craft Launcher installation (launcher source) — with fail-closed checksum verification, safe extraction into a per-app versioned cache, and a structured report, without installing or launching any desktop application unless explicitly asked.

## ADDED Requirements

### Requirement: Supported apps
The provisioner SHALL support exactly the apps in the craft app registry: `photocraft`, `vectorcraft`, `filmcraft`, `lightcraft`, `pdfcraft`, `effectcraft`, `designcraft`, `figcraft`, `wordcraft`, `soundcraft`, `deckcraft`, `cadcraft`, `gridcraft`, each mapped to its upstream repository `storytold/<app>` and CLI binary `<app>-cli` (`<app>-cli.exe` on Windows). Any other app id SHALL be rejected with an error listing the supported ids.

#### Scenario: Unknown app id
- **WHEN** provisioning is requested for `paintcraft`
- **THEN** it fails without any network request and the error lists the 13 supported app ids

### Requirement: Per-app release version resolution
For each app the provisioner SHALL resolve the release from, in precedence order: a binary override `<APP>_BIN`, a version pin `<APP>_VERSION` (where `<APP>` is the upper-cased app id, e.g. `FILMCRAFT_BIN`), then the app repository's latest non-prerelease release. Versions SHALL be normalised by stripping one leading `v`. The latest-release lookup SHALL be cached per app for 24 hours; an unreadable or future-dated cache record SHALL be ignored and refetched. `GITHUB_TOKEN`, when set, SHALL be sent as the API bearer credential. When the lookup fails and at least one version of that app is installed, the highest installed version SHALL be used with a stderr warning; when none is installed, provisioning SHALL fail naming the HTTP status or network error and suggesting `GITHUB_TOKEN`, `<APP>_VERSION` or `<APP>_BIN`.

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
The provisioner SHALL map host OS and architecture to exactly one release asset per app: when the release contains a CLI-only asset for the host (`<app>-cli-<ver>-<host>.<ext>`) it SHALL be used; otherwise the portable archive (`<app>-<ver>-linux-<arch>.tar.gz`, `<app>-<ver>-freebsd-x86_64.tar.gz`, `<app>-<ver>-windows-<arch>-portable.zip`). On Linux it SHALL first enforce the app's minimum glibc version from the registry. Unsupported hosts SHALL fail naming the OS, the architecture and `<APP>_BIN`.

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
The provisioner SHALL list archive entries before extracting and abort on absolute paths, `..` segments, symbolic/hard links or special files; extract into a staging directory; locate the CLI at the registry-known location for the asset kind, else as the single file with the CLI basename outside `__MACOSX`; and atomically move the tree to `<cache root>/<app>/<version>/`. The cache root SHALL be `CRAFT_HOME` or, by default, `<pi agent dir>/tools` (pi agent dir = `PI_CODING_AGENT_DIR` or `~/.pi/agent`). For `photocraft`, `PHOTOCRAFT_HOME`, when set, SHALL be used as the per-app directory. Desktop executables in the extracted tree SHALL be deleted; only the CLI is executed. Concurrent provisioning of the same app version SHALL yield one complete install; stale staging directories older than one hour SHALL be removed.

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
The provisioner SHALL honour `CRAFT_SOURCE` = `managed` (default), `launcher` or `auto`. `managed` SHALL use release provisioning. `launcher` SHALL resolve the app's CLI from an ArtCraft Craft Launcher installation, verify it runs `--version`, and SHALL NOT download anything; if the app is not installed by the launcher it SHALL fail naming the app and suggesting `pi-craft launcher install` or `CRAFT_SOURCE=managed`. `auto` SHALL try `launcher` first, then `managed`. A per-app override `<APP>_BIN` SHALL take precedence over every source.

#### Scenario: Launcher source never downloads
- **WHEN** `CRAFT_SOURCE=launcher` and the launcher has not installed `cadcraft`
- **THEN** provisioning of `cadcraft` fails with an error naming `cadcraft`, `pi-craft launcher install` and `CRAFT_SOURCE=managed`, and no network request is made

#### Scenario: Auto falls back to managed
- **WHEN** `CRAFT_SOURCE=auto` and the launcher has not installed `figcraft`
- **THEN** `figcraft` is provisioned from its release with report `source` reflecting the managed resolution

### Requirement: Desktop installers only on explicit request
The provisioner SHALL never download a desktop installer format (`.dmg`, `.msi`, `.deb`, `.rpm`, `.AppImage`, `.flatpak`, `.exe` setup) and SHALL never launch a desktop app, except for the explicit `pi-craft launcher install` command, which SHALL download the Craft Launcher installer for the host from `storytold/craft-launcher`, verify it against that release's `SHA256SUMS.txt` (fail closed), and hand it to the OS installer.

#### Scenario: App provisioning fetches only CLI archives
- **WHEN** any app is provisioned with `CRAFT_SOURCE=managed`
- **THEN** the only release files requested are the mapped archive and `SHA256SUMS.txt`

#### Scenario: Launcher installer is verified
- **WHEN** `pi-craft launcher install` runs on macOS and the downloaded `.dmg` digest does not match `SHA256SUMS.txt`
- **THEN** the file is deleted, nothing is opened, and the exit code is `69`

### Requirement: Provisioning report
Each provisioning run SHALL be able to report one JSON object with `app`, `version`, `source` (`override`, `pin`, `latest`, `latest-cached`, `fallback-installed`, `launcher`), `asset` (`null` for override/launcher), `cacheHit`, `binary` (absolute path), `durationMs`, and on macOS managed installs `gatekeeper` (assessment result; a rejection warns but does not fail).

#### Scenario: Fresh install report
- **WHEN** `soundcraft` `0.6.1` is installed on an empty cache
- **THEN** the report contains `app: "soundcraft"`, `version: "0.6.1"`, `source: "latest"`, the asset name, `cacheHit: false`, an absolute binary path and a duration
