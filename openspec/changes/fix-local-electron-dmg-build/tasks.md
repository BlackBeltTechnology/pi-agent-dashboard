# Tasks

## 1. Rewire `build-installer.sh` native build

- [ ] 1.1 In `packages/electron/scripts/build-installer.sh` `build_native()`, replace the single `npm run make -- --arch "$target_arch"` (line ~369) with a platform branch mirroring `.github/workflows/_electron-build.yml`.
- [ ] 1.2 **darwin arm:** `electron-forge package --platform=darwin --arch=<a>` → resolve `.app` path under `out/PI-Dashboard-darwin-<a>/PI-Dashboard.app` → `CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dmg --prepackaged "$APP_PATH" --config electron-builder.yml`. Resolve `.app` path robustly (glob `out/*/*.app`, fail with a clear error if absent — CI does this).
- [ ] 1.3 **linux arm:** keep `electron-forge make -- --arch <a>` for the `.deb`, then `npx electron-builder --linux AppImage --prepackaged "$PKG_DIR" --config electron-builder.yml` where `$PKG_DIR` = the Forge-packaged dir under `out/`.
- [ ] 1.4 Remove the obsolete `# macos-alias native-module gate (DMG maker prerequisite)` block (lines ~354-368) — electron-builder's DMG target does not use `macos-alias`.
- [ ] 1.5 Confirm the `resources/.last-arch` stale-cache invalidation + `--mac-both` orchestration still wrap the new build correctly (they call `build_native` per arch; no change expected, verify).
- [ ] 1.6 Verify the DMG Mach-O arch-tag smoke check (lines ~463-480) still finds `out/**/*.dmg` — electron-builder writes the DMG under `out/` per `electron-builder.yml artifactName`; adjust the `find` root if the path differs from the old maker output.

## 2. Reconcile drifted tests

- [ ] 2.1 Grep for tests asserting a `@electron-forge/maker-dmg` config or a "resolved DMG maker name" (the regression test named in the spec). Update/remove — no DMG maker exists. Keep `build-config-parity.test.ts` (appId/productName/executableName agreement across `forge.config.ts` + `electron-builder.yml` + `electron-builder-nsis.json`) green.
- [ ] 2.2 If the `macos-alias` postinstall hook + Doctor row are removed (per design D3/open-question), delete/adjust their tests; else leave dormant.

## 3. Remove obsolete macos-alias plumbing (per design D3 — confirm during verify)

- [ ] 3.1 **[decision]** Remove `packages/electron/scripts/ensure-macos-alias.mjs` invocation from `build-installer.sh` + the `postinstall` hook, OR keep dormant. Record decision.
- [ ] 3.2 If removed, drop the Doctor `macos-alias native module` diagnostic row + its test; else leave.

## 4. Documentation (delegate docs/ writes to a subagent, caveman style)

- [ ] 4.1 `docs/faq.md` "How do I build a native installer" section: the step-by-step currently lists `npm run make`; update to the package → electron-builder flow.
- [ ] 4.2 Directory `AGENTS.md` rows for `build-installer.sh` (scripts dir) + `forge.config.ts` if they describe the make-based DMG flow.

## 5. Validate

- [ ] 5.1 `npm test` — all green (incl. `build-config-parity.test.ts`).
- [ ] 5.2 Local: `npm run electron:build` on macOS (Apple Silicon) → produces `out/**/PI-Dashboard-*-arm64.dmg` + `latest-mac.yml` + `app-update.yml`. Mount, verify the app launches, no wizard, dashboard opens.
- [ ] 5.3 Local: `npm run electron:build -- --arch x64` on Apple Silicon (Rosetta) → produces the x64 DMG; arch smoke check passes.
- [ ] 5.4 `npm run electron:build -- --mac-both` → both DMGs, correct Mach-O arch tags.
- [ ] 5.5 On a Linux host (or Docker): `npm run electron:build -- --linux` → `.deb` + `.AppImage` + `latest-linux.yml`.
- [ ] 5.6 Diff local output filenames/metadata against a CI `_electron-build.yml` run for the same arch — confirm parity.
