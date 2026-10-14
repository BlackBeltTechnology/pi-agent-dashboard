## Purpose
Install, update, inspect and launch the ArtCraft studio desktop app on macOS and Windows from its upstream GitHub releases, verifying installer authenticity by platform code signature, and hand files to the running app.

## ADDED Requirements

### Requirement: Explicit install and update with signature verification
`pi-craft artcraft install [--version <v>]` and `pi-craft artcraft update` SHALL download the host's installer from `storytold/artcraft` releases (macOS: universal app archive or dmg; Windows: msi), SHALL verify it before use — macOS: valid code signature and Gatekeeper install assessment with the pinned Team ID; Windows: valid Authenticode signature with the pinned publisher — and, when the registry pins a SHA-256 for that version, the digest. Any verification failure SHALL delete the download, install nothing and exit `69`. Installation SHALL be per-user and SHALL happen only on these explicit commands. On Linux the commands SHALL exit `1` stating ArtCraft studio has no Linux build.

#### Scenario: Wrong signer rejected
- **WHEN** the downloaded macOS app is signed by a Team ID other than the pinned one
- **THEN** the download is deleted, nothing is installed, and the exit code is `69`

#### Scenario: Linux host
- **WHEN** `pi-craft artcraft install` runs on Linux
- **THEN** nothing is downloaded and stderr states that ArtCraft studio is available for macOS and Windows only

### Requirement: Status, launch and open
`pi-craft artcraft status [--json]` SHALL report the installed version (or none), the latest available version and whether an account session exists, without downloading. `pi-craft artcraft launch` SHALL start the installed app; `pi-craft artcraft open <file…>` SHALL open the given existing files in it. Both SHALL fail with exit `1` naming `pi-craft artcraft install` when the app is not installed.

#### Scenario: Open without install
- **WHEN** `pi-craft artcraft open frame.png` runs and ArtCraft studio is not installed
- **THEN** nothing is launched and the error names `pi-craft artcraft install`

#### Scenario: Status is offline-safe
- **WHEN** `pi-craft artcraft status` runs without network
- **THEN** it reports the installed version and marks the latest version as unknown, exiting `0`
