## Why

Local `electron-forge make` invocations on macOS (arm64 native) fail in the DMG-maker step with `Cannot find module '../build/Release/volume.node'` from the transitive `macos-alias` native module pulled in by `appdmg` → `electron-installer-dmg` → `@electron-forge/maker-dmg`. The packaged `.app` itself is produced correctly (Electron Packager step succeeds), but no `.dmg` artifact is emitted. CI publishes via the same workflow, so any regression that escapes a local smoke test ships unnoticed. The root cause is that `macos-alias` ships an `install` script that compiles `volume.node` via `node-gyp`, and pnpm hoisting under `node_modules/.pnpm/macos-alias@0.2.12/node_modules/macos-alias/` skips the lifecycle script when the package was installed with `--ignore-scripts` or when no Xcode CLT is available at install time.

## What Changes

- Add a `postinstall` hook in `packages/electron/package.json` (run only on `darwin`) that invokes `npm rebuild macos-alias --prefix=<resolved-path-to-pnpm-store-copy>` to compile `volume.node`. The hook SHALL be idempotent and SHALL succeed silently when the native module is already built.
- Add a build-time gate to `packages/electron/scripts/build-installer.sh`: when the host platform is `darwin` AND the user is running a make target that produces a DMG, the script SHALL verify `node_modules/.pnpm/macos-alias@*/node_modules/macos-alias/build/Release/volume.node` exists. If absent, it SHALL attempt to rebuild it once before continuing, and SHALL fail with a clear actionable message (mentioning Xcode CLT requirement) if rebuild also fails.
- Add a Doctor diagnostic row (`packages/shared/src/doctor-core.ts`) for `macos-alias volume.node` on darwin, surfaced in the Electron Doctor window. Helps local contributors diagnose without grepping forge logs.
- Document the failure mode and rebuild command in `docs/file-index-electron.md` and `docs/faq.md`.
- No user-facing artifact changes. Strictly local-developer ergonomics + CI safety net.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `electron-build-pipeline`: add a requirement that DMG-maker prerequisites SHALL be verified before invoking forge make on darwin.

## Impact

- **Code**: `packages/electron/package.json`, `packages/electron/scripts/build-installer.sh`, `packages/shared/src/doctor-core.ts`.
- **Tests**: none (the postinstall is environmental; covered by CI build success on darwin runners).
- **Migration / compat**: build-time only. Local developers without Xcode CLT will get a clear error instead of a confusing stack trace; once CLT is installed the build proceeds.
- **Rollback**: remove the postinstall + script gate; reverts to current "silent stack trace" behavior. No persisted state.
- **Risk**: low. Worst case the rebuild fails and the script exits with a clear message; the previous failure path was a forge stack trace, so this is strictly better.
- **Alternative considered**: replace `@electron-forge/maker-dmg` (which depends on `appdmg`) with `electron-builder`'s `dmg` target, which has no native-module dependency. Rejected for this change because the migration is larger than the fix; revisit if `macos-alias` continues to cause friction.
