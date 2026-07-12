# Design — fix-local-electron-dmg-build

## Context

Two artifacts drifted apart when `fix-electron-auto-update-pipeline` (D1) replaced `@electron-forge/maker-dmg` with `electron-builder --prepackaged`:

| Artifact | State |
|---|---|
| `forge.config.ts` | ✅ updated — makers = `[maker-deb]` only; DMG/AppImage delegated to electron-builder |
| `electron-builder.yml` | ✅ present — `mac: target dmg`, `linux: target AppImage`, `npmRebuild: false` |
| `.github/workflows/_electron-build.yml` | ✅ updated — package → electron-builder --prepackaged |
| `packages/electron/scripts/build-installer.sh` | ❌ **stale** — still `npm run make` only |
| `openspec/specs/electron-build-pipeline/spec.md` | ❌ **stale** — describes maker-dmg + macos-alias gate |

## The CI flow to mirror (`_electron-build.yml`)

macOS leg (verbatim intent):
```bash
../../node_modules/.bin/electron-forge package --arch=<a> --platform=darwin
APP_PATH="<out>/PI-Dashboard-darwin-<a>/PI-Dashboard.app"
CSC_IDENTITY_AUTO_DISCOVERY=false \
  npx electron-builder --mac dmg --prepackaged "$APP_PATH" --config electron-builder.yml
```

Linux leg:
```bash
electron-forge make -- --arch <a>            # .deb (forge maker-deb)
PKG_DIR="<out>/PI-Dashboard-linux-<a>"
npx electron-builder --linux AppImage --prepackaged "$PKG_DIR" --config electron-builder.yml
```

## Decisions

### D1 — Mirror CI, don't invent a new flow
`build_native()` in `build-installer.sh` adopts the exact package → electron-builder sequence from `_electron-build.yml`. Rationale: CI is the source of truth for a correct build; divergence is the bug. A shared `.mjs` helper invoked by both is tempting but out of scope — keep the change surgical (edit the bash function), leave dedup for a later refactor.

### D2 — Drop the `macos-alias` / `volume.node` gate
`electron-builder`'s `dmg` target builds the disk image with `hdiutil` + its own `dmg-license`/`app-builder` tooling, NOT the `macos-alias` npm module (which was a transitive dep of the removed `@electron-forge/maker-dmg`). The build-installer.sh gate at the old `# macos-alias native-module gate (DMG maker prerequisite)` block is dead weight and prints a misleading prerequisite. Remove it.

### D3 — Spec reconciliation scope
Reconcile only the requirements made factually wrong by the maker-dmg→electron-builder switch:
- **MODIFY** "Cross-platform build script" › Native build scenario (package + electron-builder).
- **MODIFY** "npm scripts for Electron" › `electron:build` / `electron:make` scenarios (drop "electron-forge make" as the DMG step wording).
- **MODIFY** "DMG configuration" — DMG produced by electron-builder (`electron-builder.yml` `artifactName: PI-Dashboard-${version}-${arch}.dmg`); drop the "resolved DMG maker `name` field" regression-test scenario (no maker exists) and replace with a config-parity assertion.
- **REMOVE** "macos-alias native module readiness on darwin" and "Doctor diagnostic for DMG prerequisites" — obsolete once the DMG maker is gone. (The Doctor row + postinstall hook removal is code work tracked in tasks; if the team prefers to keep the postinstall as harmless, that is a smaller alternative — flagged for the proposal's verify step.)

### D4 — Preserve the signing seam
The electron-builder step MUST run with `CSC_IDENTITY_AUTO_DISCOVERY=false` so it wraps the Forge-signed `.app` without re-signing/stripping the Developer-ID signature (matches CI + the `electron-builder.yml` comment). Unsigned local dev builds are unaffected (no identity present).

## Open question for the proposal's own explore/verify
Whether to fully remove the `macos-alias` postinstall hook + `ensure-macos-alias.mjs` + the Doctor row, or keep them dormant. Removing is cleaner (no dead native-module compile on `pnpm install`); keeping is lower-risk. Recommendation: remove, since the only consumer was the deleted DMG maker.
