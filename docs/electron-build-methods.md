# Electron Build Methods

Three ways to build the Electron app. Each suits a different scenario.

## Comparison

| | **Local native** | **Docker (cross-compile)** | **CI (`publish.yml`)** |
|---|---|---|---|
| **Trigger** | `npm run electron:build` | `npm run electron:build -- --windows/--linux` | Git tag push (`v*`) |
| **Runs on** | Your machine | Docker container (Node 22 Debian) on your machine | GitHub-hosted native runners per platform |
| **macOS DMG** | ✅ native | ❌ | ✅ `macos-14` (arm64) + `macos-15-intel` (x64) |
| **Linux .deb/.AppImage** | ✅ if on Linux | ✅ via Docker | ✅ `ubuntu-latest` (x64) + `ubuntu-24.04-arm` (arm64) |
| **Windows NSIS .exe** | ❌ removed | ❌ removed | ❌ removed |
| **Windows .zip** | ✅ if on Windows | ✅ via Docker | ✅ `windows-latest` |
| **Windows portable .exe** | ✅ if on Windows | ✅ via Docker (7-Zip SFX) | ✅ `windows-latest` |
| **node-pty native modules** | ✅ match host platform | ⚠️ cross-compiled — may mismatch target | ✅ always native match |
| **Offline npm cache** | ⚙️ opt-in: `BUNDLE_OFFLINE_PACKAGES=1` | ⚙️ opt-in: `BUNDLE_OFFLINE_PACKAGES=1` | ✅ always on (`bundle-offline-packages.mjs`) |
| **Bundled extensions** | ⚙️ opt-in: `BUNDLE_RECOMMENDED_EXTENSIONS=1` | ⚙️ opt-in: `BUNDLE_RECOMMENDED_EXTENSIONS=1` | ✅ always on (SPDX-checked, 15 MB budget) |
| **Bundled Node.js** | ✅ (`download-node.sh`) | ✅ (downloaded for Windows target) | ✅ per-platform download |
| **Code signing** | ❌ | ❌ | ✅ Authenticode (Windows) + notarization (macOS) |
| **Upload to GitHub Release** | ❌ | ❌ | ✅ attached to draft release |

## Local native

Builds for the current host platform only.

```bash
npm run electron:build
# equivalent: bash packages/electron/scripts/build-installer.sh
```

Flags:
- `--arch x64` — override architecture
- `--skip-client` — skip web client rebuild
- `--mac-both` — arm64 + x64 DMGs on Apple Silicon (requires Rosetta 2)

Outputs in `packages/electron/out/make/`.

> **Windows**: NSIS installer removed. ZIP (`.zip`) and portable `.exe` (7-Zip SFX, no NSIS) remain.

## Docker (cross-compile)

Builds Linux or Windows artifacts from any host with Docker. Docker must be running.

```bash
npm run electron:build -- --windows        # Windows .zip + portable .exe (no NSIS)
npm run electron:build -- --linux          # Linux .deb + .AppImage
npm run electron:build -- --linux --windows  # both
npm run electron:build -- --all            # native + Linux + Windows
```

Docker image: Node 22 Debian (`packages/electron/scripts/Dockerfile.build`).
Entrypoint: `docker-make.sh` — runs `electron-forge package`, then `zip`, then `electron-builder --win portable`.

**Limitations:**
- NSIS installer skipped — uninstaller extractor requires Wine; produced only by CI.
- `node-pty` `.node` files are Linux-compiled; mismatch on a real Windows runtime (use CI builds for distribution).

## CI (`publish.yml`)

Fires on `v*` tag push. Runs a native runner per platform in parallel.

```bash
# cut a release (see release-cut skill)
git push --follow-tags
```

Native runner matrix:

| Runner | Artifact |
|---|---|
| `macos-14` | arm64 `.dmg` |
| `macos-15-intel` | x64 `.dmg` |
| `ubuntu-latest` | x64 `.deb` + `.AppImage` |
| `ubuntu-24.04-arm` | arm64 `.deb` |
| `windows-latest` | x64 `.exe` (NSIS) + `.zip` + portable |
| `windows-latest` (arm64 matrix entry) | `.zip` + portable |

Steps always enabled on CI, opt-in locally:
- `bundle-offline-packages.mjs` — packs `pi`/`openspec`/`tsx` into per-platform cacache tarball for offline first-run install. Enable locally: `BUNDLE_OFFLINE_PACKAGES=1 npm run electron:build`.
- `bundle-recommended-extensions.mjs` — clones bundled extension IDs (SPDX allowlist + 15 MB budget). Enable locally: `BUNDLE_RECOMMENDED_EXTENSIONS=1 npm run electron:build`.
- Code signing — Authenticode for Windows, notarization for macOS.
- Upload artifacts to draft GitHub Release (notes from matching `## [<version>]` in `CHANGELOG.md`).

## When to use each

| Scenario | Method |
|---|---|
| Quick local packaging test | Local native |
| Test Windows zip without a Windows machine | Docker `--windows` |
| Production release — all platforms, signed, offline-capable | CI via tag push |

## Build Windows ZIP specifically

Dedicated script that runs the full pipeline (web → server → package → zip) with automatic platform detection:

```bash
# From macOS/Linux (cross-compiles via Docker)
./packages/electron/scripts/build-windows-zip.sh

# arm64 target
./packages/electron/scripts/build-windows-zip.sh --arch arm64

# Skip web client rebuild (already built)
./packages/electron/scripts/build-windows-zip.sh --skip-client

# ZIP only, no portable .exe
./packages/electron/scripts/build-windows-zip.sh --no-portable

# On Windows (native, no Docker needed)
bash packages/electron/scripts/build-windows-zip.sh
```

### What the script does

| Step | Action | Native Win | Docker |
|------|--------|-----------|--------|
| 1 | `npm run build` — Vite web client | ✅ direct | ✅ direct (before Docker) |
| 2 | `bundle-server.mjs` — copy server source → `resources/server/` | ✅ direct | ✅ inside Docker |
| 3 | `npm install` in `resources/server/` — Windows native modules | ✅ direct | ✅ inside Docker |
| 4 | Download Windows Node.js → `resources/node/` | ✅ direct | ✅ inside Docker |
| 5 | `electron-forge package --platform win32` | ✅ direct | ✅ inside Docker |
| 6 | `zip` → `out/make/zip/x64/PI-Dashboard-win32-x64.zip` | ✅ direct | ✅ inside Docker |
| 7 | `electron-builder --win portable` → `PI-Dashboard-portable.exe` | ✅ opt-in | ✅ opt-in |

## Related files

- `packages/electron/scripts/build-installer.sh` — main build script (orchestrates native + Docker)
- `packages/electron/scripts/docker-make.sh` — Docker entrypoint (package + zip + portable)
- `packages/electron/scripts/Dockerfile.build` — Node 22 Debian build image
- `packages/electron/scripts/bundle-offline-packages.mjs` — offline cacache bundler (CI only)
- `packages/electron/scripts/bundle-recommended-extensions.sh` — extension bundler (CI only)
- `.github/workflows/publish.yml` — CI release workflow
