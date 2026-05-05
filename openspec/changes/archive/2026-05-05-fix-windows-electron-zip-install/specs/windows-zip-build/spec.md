## ADDED Requirements

### Requirement: Local Windows ZIP build script with lossless extractor
The script `packages/electron/scripts/build-windows-zip.sh` SHALL produce a Windows ZIP artifact under `packages/electron/out/make/zip/<arch>/PI-Dashboard-win32-<arch>.zip` from a single command. It SHALL extract the Node.js Windows distribution losslessly (`ditto` on macOS, `7z` when present, fallback to `unzip` with post-extraction file-count validation) so that nested `node_modules` files are not silently dropped.

The script SHALL run, in order: web client build (skippable via `--skip-client`), `bundle-server.mjs` (full install), Windows Node.js download, `bundle-offline-packages.mjs --platform=win32-<arch>`, `electron-forge package --platform win32 --arch <arch>`, and zip creation.

#### Scenario: macOS host produces a Windows ZIP without dropped files
- **WHEN** `build-windows-zip.sh` runs on a macOS host with `ditto` available
- **THEN** the produced ZIP's `resources/node/node_modules/npm/node_modules/minizlib/dist/commonjs/package.json` SHALL be present
- **AND** the produced ZIP's nested `minipass` package SHALL be the v7+ shape with `Minipass` named export

#### Scenario: extraction failure aborts the build
- **WHEN** the post-extraction sanity check finds `minizlib/dist/commonjs/package.json` missing
- **THEN** the script SHALL exit non-zero with an actionable error message naming the missing file and suggesting `ditto` / `7z` install

#### Scenario: bundled Node version is at least v22.18.0
- **WHEN** `build-windows-zip.sh`, `build-installer.sh`, `docker-make.sh`, `download-node.sh`, or the publish workflow downloads Node.js
- **THEN** the version SHALL be `v22.18.0` or higher (avoids nodejs/node#58515 Fastify-startup crash)

### Requirement: Offline cache built with bundled npm when host matches target
`packages/electron/scripts/bundle-offline-packages.mjs` SHALL detect when the build host platform matches the target platform and a bundled Node distribution exists at `packages/electron/resources/node/`. In that case it SHALL invoke the bundled `node.exe` + `npm-cli.js` to build the cacache snapshot, ensuring the cache uses the same npm major.minor version as the runtime install.

#### Scenario: Windows host with bundled npm uses bundled npm
- **WHEN** the script runs on a Windows host targeting `win32-x64` and `resources/node/node.exe` + `node_modules/npm/bin/npm-cli.js` exist
- **THEN** the script SHALL log `using bundled npm: <node.exe> <npm-cli.js>`
- **AND** the cacache SHALL be populated by spawning the bundled binary

#### Scenario: cross-build host falls back to system npm
- **WHEN** the script runs on macOS targeting `win32-x64`
- **THEN** the script SHALL log a parity warning and fall back to system npm
- **AND** SHALL still produce a valid cacache (npm cache integrity hashes are universal across npm versions)

### Requirement: Docker Windows ZIP-only build path
`build-installer.sh` SHALL accept a `--windows-zip` flag that triggers a Docker build producing only the Windows ZIP artifact (no NSIS installer, no portable exe). The flag SHALL set the `ZIP_ONLY=1` environment variable inside the Docker container, which `docker-make.sh` honors by skipping the `electron-builder --win portable` step.

#### Scenario: Windows ZIP-only Docker build skips portable exe
- **WHEN** `build-installer.sh --windows-zip` runs and Docker succeeds
- **THEN** the artifacts directory SHALL contain `out/make/zip/<arch>/*.zip`
- **AND** SHALL NOT contain `out/make/portable/<arch>/*.exe`
