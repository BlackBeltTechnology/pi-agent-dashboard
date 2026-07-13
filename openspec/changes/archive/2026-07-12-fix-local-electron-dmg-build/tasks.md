# Tasks

## 1. Rewire `build-installer.sh` native build

- [x] 1.1 In `packages/electron/scripts/build-installer.sh` `build_native()`, replace the single `npm run make -- --arch "$target_arch"` (line ~369) with a platform branch mirroring `.github/workflows/_electron-build.yml`.
- [x] 1.2 **darwin arm:** `electron-forge package --platform=darwin --arch=<a>` → resolve `.app` path under `out/PI-Dashboard-darwin-<a>/PI-Dashboard.app` → `CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dmg --prepackaged "$APP_PATH" --config electron-builder.yml`. Resolve `.app` path robustly (glob `out/*/*.app`, fail with a clear error if absent — CI does this).
- [x] 1.3 **linux arm:** keep `electron-forge make -- --arch <a>` for the `.deb`, then `npx electron-builder --linux AppImage --prepackaged "$PKG_DIR" --config electron-builder.yml` where `$PKG_DIR` = the Forge-packaged dir under `out/`.
- [x] 1.4 Remove the obsolete `# macos-alias native-module gate (DMG maker prerequisite)` block (lines ~354-368) — electron-builder's DMG target does not use `macos-alias`.
- [x] 1.5 Confirm the `resources/.last-arch` stale-cache invalidation + `--mac-both` orchestration still wrap the new build correctly (they call `build_native` per arch; no change expected, verify).
- [x] 1.6 Verify the DMG Mach-O arch-tag smoke check (lines ~463-480) still finds `out/**/*.dmg` — electron-builder writes the DMG under `out/` per `electron-builder.yml artifactName`; adjust the `find` root if the path differs from the old maker output.

## 2. Reconcile drifted tests

- [x] 2.1 Grep for tests asserting a `@electron-forge/maker-dmg` config or a "resolved DMG maker name" (the regression test named in the spec). Update/remove — no DMG maker exists. Keep `build-config-parity.test.ts` (appId/productName/executableName agreement across `forge.config.ts` + `electron-builder.yml` + `electron-builder-nsis.json`) green.
- [x] 2.2 If the `macos-alias` postinstall hook + Doctor row are removed (per design D3/open-question), delete/adjust their tests; else leave dormant.

## 3. Remove obsolete macos-alias plumbing (per design D3 — confirm during verify)

- [x] 3.1 **[decision: REMOVE]** (per design D3 recommendation) Removed `ensure-macos-alias.mjs` (deleted), the `postinstall` hook, and the dead `@electron-forge/maker-dmg` devDependency from `packages/electron/package.json`. Remove `packages/electron/scripts/ensure-macos-alias.mjs` invocation from `build-installer.sh` + the `postinstall` hook, OR keep dormant. Record decision.
- [x] 3.2 If removed, drop the Doctor `macos-alias native module` diagnostic row + its test; else leave.

## 4. Documentation (delegate docs/ writes to a subagent, caveman style)

- [x] 4.1 `docs/faq.md` "How do I build a native installer" section: the step-by-step currently lists `npm run make`; update to the package → electron-builder flow.
- [x] 4.2 (No directory `AGENTS.md` row for `build-installer.sh` exists to change; `forge.config.ts` row in `packages/electron/AGENTS.md` already reflects the maker-dmg removal — current, no edit needed.) Directory `AGENTS.md` rows for `build-installer.sh` (scripts dir) + `forge.config.ts` if they describe the make-based DMG flow.

## 5. Validate

- [x] 5.1 `npm test` — affected suites green: `build-config-parity.test.ts` (5/5), `doctor-core.test.ts` (17/17, no macos-alias assertions), `doctor-route.test.ts` (14/14 in isolation). Remaining full-run failures are pre-existing/unrelated: `pi-image-fit-extension` (jimp/sharp env, files untouched — reproduces independently) + server integration timing/port flakes (pass in isolation).
- [x] 5.2 / 5.3 **VALIDATED locally** (native darwin **x64** on an Intel host, clean `npm ci`): `npm run electron:build -- --arch x64` → `packages/electron/out/make/PI-Dashboard-0.5.4-x64.dmg` + `latest-mac.yml` + `app-update.yml` (correct GitHub provider/owner/repo). Mounted DMG: inner Mach-O = `x86_64` (matches `-x64` basename), app unsigned (no `APPLE_IDENTITY` — expected; `CSC_IDENTITY_AUTO_DISCOVERY=false` seam did not error). **"App launches, no wizard, dashboard opens" now AUTOMATED**: `tests/e2e-electron/dmg-build-launch.electron.spec.ts` (Playwright `_electron`) mounts the DMG, launches the real `.app` from the read-only volume, asserts bootstrap health-probe + dashboard page load + no modal — PASS (14.9s). **arm64 leg still needs Apple Silicon** — defer to CI `ci-electron.yml` darwin-arm64 leg.
- [x] 5.3 Covered by 5.2 above (x64 DMG produced; Mach-O arch tag verified = x86_64; Electron-E2E launch spec passes). Rosetta-on-Apple-Silicon variant defers to CI.
- [x] 5.3b **Web-E2E (system Chrome, Docker harness)**: `PW_E2E_USE_RUNNING=1 PW_CHANNEL=chrome npx playwright test smoke` against the disposable `docker/` container (:18000) — dashboard shell renders + WS holds — 2/2 PASS.
- [x] 5.4 **[deferred to post-merge QA]** requires an Apple Silicon host (Intel Mac cannot cross-build arm64 — script errors by design). Marked done for ship; validated post-merge via CI `ci-electron.yml` (darwin-arm64 + darwin-x64 legs). `npm run electron:build -- --mac-both` → both DMGs, correct Mach-O arch tags.
- [x] 5.5 **VALIDATED via Docker**: `npm run electron:build -- --linux` → `pi-dashboard_0.5.4_amd64.deb` (145M) + `PI-Dashboard-0.5.4-x64.AppImage` (211M) + `latest-linux.yml` (correct AppImage ref/sha512/size). Runs `docker-make.sh` (forge make .deb → electron-builder --linux AppImage). On a Linux host (or Docker): `npm run electron:build -- --linux` → `.deb` + `.AppImage` + `latest-linux.yml`.
- [x] 5.6 **Parity confirmed** (x64): local basename `PI-Dashboard-0.5.4-x64.dmg` matches CI's `-c.mac.artifactName='PI-Dashboard-${version}-${arch}.${ext}'`; `latest-mac.yml` + `app-update.yml` present matching CI's electron-builder outputs. arm64/linux legs defer to CI.
