## Why

v0.5.0 shipped two Windows portable artifacts — `PI-Dashboard-x64-portable.exe` and `PI-Dashboard-arm64-portable.exe`, produced via `electron-builder --win portable` (7-Zip SFX). Field reports confirm **neither launches**: the SFX self-extracts under `%LOCALAPPDATA%\Temp\<random>\` and the app either silently fails to start or crashes before any window appears. As a stop-gap, both assets were deleted from the v0.5.0 GitHub Release and a "Known issue" notice was prepended to the release body; README and the marketing site no longer advertise the portable option.

The portable target is still wired in the build pipeline (`.github/workflows/publish.yml`, `packages/electron/scripts/build-windows-zip.sh`, `packages/electron/scripts/docker-make.sh`, `packages/electron/scripts/build-installer.sh`), so the next release would re-publish the same broken binary unless we either fix it or pull the target.

## What Changes

- **Reproduce + diagnose** the portable launch failure on Windows x64 and arm64. Capture the exact failure surface (no window, crash dialog, exit code, log output, Event Viewer entry) on a clean Windows host using the existing `qa/remote/` harness (`automate-windows-remote-qa`). Hypothesized root causes, in priority order:
  1. Bootstrap state writes (`~/.pi-dashboard/`, version-marker extraction, `installable.json` seeding) collide with the SFX's ephemeral `%LOCALAPPDATA%\Temp\<random>\` working directory, so the second launch sees a stale marker pointing at a directory the previous SFX already deleted.
  2. `app.getPath('exe')` / `process.resourcesPath` resolve to a path that disappears between launches, breaking the `selectLaunchSource()` resolver's `extracted` branch (`packages/electron/src/lib/launch-source.ts`) and / or `bundle-extract.ts`'s `needsExtraction` heuristic.
  3. Bundled native modules (`node-pty` spawn-helper, anything ASAR-unpacked) hold absolute paths into the SFX temp dir that survive across runs as dangling pointers.
  4. AV / SmartScreen blocking the unsigned SFX before it finishes extraction (manifests as "the app didn't even open"). Distinct from the above — would require codesigning, not a code fix.
- **Decide outcome based on diagnosis:**
  - **Fixable** → land the targeted fix, re-enable portable in `publish.yml` (currently still wired — no flag flip needed), add a smoke test under `qa/tests/` that runs the portable artifact through `qa/remote/` and asserts `/api/health` responds within N seconds.
  - **Not fixable in reasonable time** → drop the portable target permanently: delete the `npx electron-builder --win portable` step from `.github/workflows/publish.yml` (lines ~573–581), remove the matching block in `packages/electron/scripts/build-windows-zip.sh` (step 7) and `packages/electron/scripts/docker-make.sh`, drop `--no-portable` flag plumbing from `build-installer.sh`, and remove `electron-builder` from `packages/electron/package.json` if no other target uses it. Update CHANGELOG accordingly.
- **Either path** updates the `qa/tests/` Windows suite to cover whichever Windows artifacts continue to ship (ZIP-only, or ZIP + portable).

**Non-goals:** Windows codesigning (separate change — would also help with SmartScreen warnings on the ZIP); reviving NSIS (already removed in 0.5.0 per `simplify-electron-bootstrap-derived-state`); MSI / MSIX targets.

## Capabilities

### Modified Capabilities

- `electron-bootstrap`: must work correctly when the Electron app is launched from a 7-Zip SFX self-extracted location (transient `%LOCALAPPDATA%\Temp\<random>\` path), or the portable target must be removed from the release pipeline. The `selectLaunchSource()` `extracted` branch and `bundle-extract.ts` extraction logic must either tolerate or explicitly reject this scenario with a user-visible error rather than silently failing.

### New Capabilities

- `windows-portable-smoke-test` (only if portable is kept): an automated `qa/remote/` test path that downloads the portable artifact, runs it on a clean Windows host, and asserts the dashboard reaches `/api/health` within a bounded timeout. Wired into `qa/Makefile` as `test-windows-remote-portable` (target name already exists from `automate-windows-remote-qa` — this change makes it pass on a real artifact instead of being a placeholder).

## Impact

- **Code**: confined to `packages/electron/` (build scripts + possibly `lib/launch-source.ts`, `lib/bundle-extract.ts`) and `.github/workflows/publish.yml`. Either a small targeted fix in the bootstrap or deletion of ~30 lines of build pipeline. No protocol, no shared package, no client-side changes.
- **Production runtime**: zero impact on already-working surfaces (ZIP, DMG, .deb, .AppImage, npm-global). The portable .exe is currently deleted from v0.5.0 and not advertised, so any outcome here is strictly additive or status-quo-preserving.
- **External deps**: if portable is dropped, `electron-builder` becomes unused and can be removed from `packages/electron/package.json` devDeps (saves ~50MB of node_modules during CI).
- **Migration / rollback**: no user state involved — the broken portable binaries never produced any state to migrate. Rollback is reverting this change's commits.
- **Release**: target the next release (0.5.1 or 0.6.0) — does not require a v0.5.0 hot-fix because the broken assets are already removed from that release.
