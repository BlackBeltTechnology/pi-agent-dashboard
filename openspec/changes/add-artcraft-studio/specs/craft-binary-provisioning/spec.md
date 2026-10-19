## MODIFIED Requirements

### Requirement: Desktop installers only on explicit request
The provisioner SHALL never download a desktop installer format (`.dmg`, `.msi`, `.deb`, `.rpm`, `.AppImage`, `.flatpak`, `.exe` setup) and SHALL never launch a desktop app, except for two explicit commands: `pi-craft launcher install`, which SHALL download the Craft Launcher installer for the host from `storytold/craft-launcher`, verify it against that release's `SHA256SUMS.txt` (fail closed), and hand it to the OS installer; and `pi-craft artcraft install|update`, which SHALL download the ArtCraft studio installer from `storytold/artcraft` and verify it by pinned platform code signature (fail closed, exit `69`) as defined by `artcraft-studio-management`, because that repository publishes no `SHA256SUMS.txt`. The ArtCraft studio path is governed solely by `artcraft-studio-management`: the checksum-verification, extraction and per-app-cache requirements of this capability apply to Crafting App and Craft Launcher provisioning, not to it. `pi-craft artcraft launch|open` SHALL be the only commands that launch ArtCraft studio.

#### Scenario: App provisioning fetches only CLI archives
- **WHEN** any app is provisioned with `CRAFT_SOURCE=managed`
- **THEN** the only release files requested are the mapped archive and `SHA256SUMS.txt`

#### Scenario: Launcher installer is verified
- **WHEN** `pi-craft launcher install` runs on macOS and the downloaded `.dmg` digest does not match `SHA256SUMS.txt`
- **THEN** the file is deleted, nothing is opened, and the exit code is `69`

#### Scenario: ArtCraft installer only on its explicit command
- **WHEN** `pi-craft install --all` runs
- **THEN** nothing is requested from `storytold/artcraft` and no ArtCraft installer is downloaded

### Requirement: Checksum verification fails closed
The provisioner SHALL download the release's `SHA256SUMS.txt` and SHALL refuse to extract or use an asset unless the file contains exactly one entry for it whose SHA-256 matches the downloaded bytes (64-hex digest, optional `*` marker, leading `./` ignored, CRLF tolerated). On mismatch the download SHALL be deleted and nothing written to the version cache. This requirement covers Crafting App and Craft Launcher assets; the ArtCraft studio installer, whose releases publish no `SHA256SUMS.txt`, is verified by pinned code signature under `artcraft-studio-management` instead.

#### Scenario: Digest mismatch
- **WHEN** the computed digest of `gridcraft-cli-0.7.0-macos-universal.zip` differs from the listed one
- **THEN** provisioning fails showing expected and actual digests and `<cache>/gridcraft/0.7.0/` does not exist

#### Scenario: Sums file absent
- **WHEN** the release has no `SHA256SUMS.txt`
- **THEN** provisioning fails and nothing is written to the version cache
