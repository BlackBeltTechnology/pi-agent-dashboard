# Fix local `build-installer.sh` macOS DMG build (electron-builder, matching CI)

## Why

`npm run electron:build` (= `packages/electron/scripts/build-installer.sh`) **cannot produce a macOS DMG on darwin**. It fails hard:

```
electron-forge make --arch x64
✖ Resolving make targets [FAILED: Could not find any make targets configured for the "darwin" platform.]
```

Root cause is a **stale local wrapper**. `fix-electron-auto-update-pipeline` (D1) removed the `@electron-forge/maker-dmg` maker from `forge.config.ts` and moved DMG/AppImage production to **`electron-builder --prepackaged`** (so the build also emits the `latest-mac.yml` / `app-update.yml` metadata electron-updater needs). CI (`.github/workflows/_electron-build.yml`) was updated to the new flow:

- **macOS**: `electron-forge package --platform=darwin --arch=<a>` (signs) → `npx electron-builder --mac dmg --prepackaged "$APP_PATH" --config electron-builder.yml`.
- **Linux**: `electron-forge make` (`.deb`) → `npx electron-builder --linux AppImage --prepackaged "$PKG_DIR" --config electron-builder.yml`.

But `build-installer.sh` was **not** updated. Its native build path (`build_native()`) still calls only `npm run make -- --arch <a>` (`electron-forge make`). Consequences:

- **darwin**: `forge make` has only the Linux `maker-deb` → no darwin target → hard failure. No local macOS DMG is producible at all.
- **linux**: only the `.deb` is produced locally; no AppImage, no `latest-linux.yml` / `app-update.yml` update metadata (CI produces these, local diverges).

The `electron-build-pipeline` capability spec **also drifted** and still describes the removed world:
- "DMG configuration" requires `@electron-forge/maker-dmg` to emit the DMG basename.
- "macos-alias native module readiness on darwin" + "Doctor diagnostic for DMG prerequisites" describe `volume.node` as a DMG-maker prerequisite. `electron-builder`'s DMG target uses `hdiutil`, not `macos-alias`, so this gate is obsolete.
- "npm scripts for Electron" and "Cross-platform build script" describe `electron-forge make` as the DMG step.

Net: contributors cannot build/run a local macOS app via the documented command, and the spec no longer matches CI or `forge.config.ts`.

## What Changes

- **Rewire `build-installer.sh` `build_native()`** to mirror `_electron-build.yml`:
  - darwin → `electron-forge package --platform=darwin --arch=<a>` then `npx electron-builder --mac dmg --prepackaged "<.app path>" --config electron-builder.yml`.
  - linux → `electron-forge make -- --arch <a>` (`.deb`) then `npx electron-builder --linux AppImage --prepackaged "<packaged dir>" --config electron-builder.yml`.
  - Preserve `CSC_IDENTITY_AUTO_DISCOVERY=false` on the electron-builder step (don't re-sign; forge package owns signing) — matching CI.
- **Remove the obsolete `macos-alias`/`volume.node` build-time gate** from `build-installer.sh` (electron-builder's DMG target doesn't need it).
- **Reconcile the `electron-build-pipeline` spec** to the electron-builder reality (MODIFY the script + DMG requirements; REMOVE the macos-alias/Doctor-prereq requirements — see spec delta). Reconcile any test that pins the removed maker-dmg config (`build-config-parity.test.ts` and the "resolved DMG maker name" regression test).
- **Keep CI untouched** — `_electron-build.yml` already correct; this change makes local match CI.

## Impact

- **Contributor-facing**: `npm run electron:build` produces a runnable macOS DMG again (and a Linux AppImage + update metadata), matching CI output byte-for-flow.
- **Risk**: low-medium. Build-tooling only; no runtime/product code. `electron-builder` is already a proven dependency (CI + Windows NSIS use it). The signing seam (`CSC_IDENTITY_AUTO_DISCOVERY=false`) must be preserved to avoid stripping a Developer-ID signature on signed local builds.
- **Out of scope**: Windows local build (already electron-builder NSIS via `build-windows-zip.sh`); CI workflow (already correct); auto-update runtime behaviour.
- **Discovered by**: `auto-launch-first-run-skip-welcome` QA — building the packaged app locally hit the `forge make` darwin failure. That change worked around it with `electron-forge package` (no DMG). This change fixes the wrapper properly.

## Discipline Skills

- `doubt-driven-review` — build/release wiring is a cross-boundary step; verify the electron-builder invocation + signing seam against CI before landing.
- `systematic-debugging` — if the local electron-builder step diverges from CI output, root-cause via the CI log parity rather than guessing.
