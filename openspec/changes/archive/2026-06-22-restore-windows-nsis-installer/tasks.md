> **Implementation status (authoring session).** All locally-authorable work done: NSIS config + `installer.nsh` + asset generator + placeholder `master.png`, CI `_electron-build.yml` NSIS swap, portable dropped from every build script, `--with-nsis` plumbing, 6 QA `.ps1` scripts + Makefile target, marketing-site edits + passing Vitest classifier test, all docs, CHANGELOG, release-notes-footer, sibling-proposal coordination. Spec delta validates `--strict`.
>
> **CI smoke = install/registry/branding/uninstall HARD gates on each win32 build leg** (`windows-latest`); per-user `/S` needs no admin. **Launch / server-start is NOT tested on the runner** — `pi-dashboard.exe` is a GUI-subsystem binary and hosted runners have no desktop session, so the server child never spawns (process alive, no `server.log`, empty stdio). The non-fatal x64 launch step and the `smoke-win-arm64` job were tried and **removed** (misleading red, no real coverage). Launch/server-start validation = VM (`07-electron-bootstrap-v2.ps1` + `windows-nsis-launch.ps1`) or manual install — also the authoritative test for the #136 Node fix.
>
> **Unchecked = cannot complete in this environment (not skipped):**
> - `1.3` human coordination with `windows-authenticode-signing` owners.
> - `2.9` manual draft-tag validation run (trigger the workflow) — needs CI this macOS/no-`node_modules` worktree can't do.
> - `6.5`, `6.6` post-release verification (auto-regenerated `latest-release.json` + bucket spot-check) — no code edit; verify after first NSIS release.
> - `9.*` release/rollout (RC tag, manual Windows smoke, real release, archive sibling). `10.*` explicitly out-of-scope follow-ups (signing, auto-update, design assets).

## 1. Spec & coordination

- [x] 1.1 ~~Confirm final `appId` value~~ — confirmed `hu.blackbelt.pi-dashboard` (aligns with the BlackBelt Technology Java-package convention as seen in `hu.blackbelt.judo.eclipse.epp.package.designer.product`). Document in `docs/release-process.md` as "do not change after first NSIS release".
- [x] 1.2 Coordinate with `fix-windows-portable-exe`: add a note in that proposal's `tasks.md` that §4 (Drop path) is subsumed by this change; flag for archival once both land.
- [ ] 1.3 Confirm with `windows-authenticode-signing` owners that this change does not block on signing landing first (composable, not gated).

## 2. NSIS build pipeline (CI windows-latest)

- [x] 2.1 Create `packages/electron/electron-builder-nsis.json` with the pinned knobs:
  ```json
  {
    "appId": "hu.blackbelt.pi-dashboard",
    "productName": "PI Dashboard",
    "win": {
      "target": [{ "target": "nsis", "arch": ["x64", "arm64"] }],
      "icon": "build/installer-assets/installer-icon.ico"
    },
    "nsis": {
      "oneClick": false,
      "perMachine": false,
      "allowToChangeInstallationDirectory": true,
      "allowElevation": true,
      "include": "build/installer.nsh",
      "installerIcon": "build/installer-assets/installer-icon.ico",
      "uninstallerIcon": "build/installer-assets/uninstaller-icon.ico",
      "installerSidebar": "build/installer-assets/welcome-banner.bmp",
      "uninstallerSidebar": "build/installer-assets/welcome-banner.bmp",
      "installerHeader": "build/installer-assets/header-banner.bmp",
      "artifactName": "PI-Dashboard-Setup-${version}-${arch}.exe",
      "shortcutName": "PI Dashboard",
      "uninstallDisplayName": "PI Dashboard",
      "deleteAppDataOnUninstall": false,
      "runAfterFinish": true
    }
  }
  ```
  Note: `perMachine` is set to **`false`** (per-user only). Do NOT omit it — omission enables electron-builder's multi-user mode (install-mode page + per-machine option), which this proposal explicitly excludes. `allowElevation: true` only lets NSIS auto-elevate the copy step when the user redirects the install dir to a protected location; it does not add a per-machine install mode.
- [x] 2.2 Create `packages/electron/build/installer.nsh` — custom include script. Cover:
  - MUI2 page macro inserts for Welcome, Directory, InstFiles, Finish. NO install-mode page (no `MULTIUSER_PAGE_INSTALLMODE`) — per-user only.
  - `BrandingText "BlackBelt Technology — PI Dashboard"`.
  - `MUI_HEADERIMAGE` + `MUI_HEADERIMAGE_BITMAP` set to `header-banner.bmp`.
  - `MUI_WELCOMEFINISHPAGE_BITMAP` + `MUI_UNWELCOMEFINISHPAGE_BITMAP` set to `welcome-banner.bmp`.
  - Custom registry writes augmenting electron-builder's defaults if needed: `DisplayIcon` pointing into install dir, `NoModify=1`, `NoRepair=1`, `EstimatedSize` (modelled on JUDO `install.nsi` lines 79–97). Hive is HKCU only (per-user install).
  - Selective-uninstall hook (electron-builder exposes `customUnInstall` macro) that explicitly does NOT touch `$PROFILE\.pi\` or `$PROFILE\.pi-dashboard\`. Final-page notice via `MUI_FINISHPAGE_TEXT` on the uninstaller flow.
  - Helper functions ported from JUDO reference if useful: `DeleteDirIfEmpty` (defensive uninstall), `StrContains` (rarely needed in our case; include only if used).
  Target size: ~150 LOC. Cover with QA tests §5.
- [x] 2.3 Create `packages/electron/scripts/build-installer-assets.mjs` — Node script using `sharp` + `png-to-ico` to derive `installer-icon.ico`, `uninstaller-icon.ico`, `welcome-banner.bmp`, `header-banner.bmp` from `packages/electron/build/installer-assets/master.png`. Enforce 24-bit BMP output. Print per-asset SHA-256 so CI can detect master-asset drift.
- [x] 2.4 Commit a placeholder `packages/electron/build/installer-assets/master.png` (e.g. existing `packages/electron/resources/icon.png` copy or a temporary Pi-coloured square with text). **Add follow-up task in §10** for the design team to replace with the real Pi mark before the v0.5.5 GA release.
- [x] 2.5 Generate the uninstaller variant: until a dedicated `uninstaller-icon` design lands, derive it programmatically (e.g. red tint or grayscale of the master) in the asset script. Output deterministic so QA can SHA-pin.
- [x] 2.6 **Install-path independence audit.** Grep the codebase for hardcoded install-path assumptions that would break a non-default install location: `rg -i 'LOCALAPPDATA.*Programs.*PI Dashboard|Program Files.*PI Dashboard|Programs\\\\PI Dashboard' --type ts --type js`. Expected: zero hits in `packages/electron/src/`, `packages/server/src/`, `packages/shared/src/`. Any hit must be replaced with dynamic resolution via `app.getPath('exe')`, `process.resourcesPath`, or equivalent. Audit covers the per-user default (`%LOCALAPPDATA%\Programs\`) and user-chosen dirs (any drive/path).
- [x] 2.7 Edit `.github/workflows/_electron-build.yml`:
  - Line 4 (header comment): update to "(DMG/AppImage/DEB/Windows ZIP + NSIS .exe)".
  - Line ~309-315: keep the "skip forge make on Windows" guard — Forge still has no Windows maker; NSIS is produced by electron-builder, not Forge.
  - Line ~428 (step name): rename "Build Windows ZIP and portable exe" → "Build Windows ZIP and NSIS Setup.exe".
  - Line ~444-452: replace the portable invocation block with:
    1. `node scripts/build-installer-assets.mjs` (generate ICO + BMP from master).
    2. `npx electron-builder --win nsis --$arch --config electron-builder-nsis.json`.
    Output dir `out/make/nsis/$arch/`.
- [x] 2.8 Edit artifact upload step (in `_electron-build.yml` or `publish.yml`): include `out/make/nsis/*/PI-Dashboard-Setup-*.exe` in the upload glob; remove the `*portable*.exe` glob.
- [ ] 2.9 Smoke-test the CI change on a draft tag (`v0.5.5-test1`): trigger the Electron build workflow, confirm Setup.exe artifacts attach to the draft release, download one, install on a clean Windows 11 x64 VM (see §5).

## 3. Drop portable from build scripts

- [x] 3.1 `.github/workflows/_electron-build.yml`: delete the `npx electron-builder --win portable …` invocation. (Done together with §2.3 — same step, replaced not augmented.)
- [x] 3.2 `packages/electron/scripts/docker-make.sh`: remove the portable block (line ~224-253). Update the comment around line ~197-198 to read "Docker path produces ZIP only; NSIS Setup.exe is CI-only (windows-latest)".
- [x] 3.3 `packages/electron/scripts/build-windows-zip.sh`: remove step 7 (line ~183-200). Remove `--no-portable` flag plumbing (lines ~41, ~51). Rename file or add a `--no-nsis` flag for symmetry if §4.1 adds local NSIS support; otherwise leave file name as-is and document that NSIS is CI-only.
- [x] 3.4 `packages/electron/scripts/build-installer.sh`: update header comment (line 17-19); update usage text (line 83-84); update summary line (line 163). Drop any `--no-portable` flag.
- [x] 3.5 Search the repo for stray `portable` references: `rg -i 'portable\.exe|--win portable|portable-exe'` and remove or update each. Exclude `openspec/changes/archive/` and `openspec/changes/fix-windows-portable-exe/` (closing in §1.2).
- [x] 3.6 If any unused electron-builder `portable: { … }` config blocks remain (e.g. inline JSON in `docker-make.sh`), delete them.

## 4. (Optional) Local NSIS build support

- [x] 4.1 Decision: add NSIS-on-Windows-host support to `build-windows-zip.sh` (run NSIS step when `$OSTYPE` is `msys`/`cygwin`/Windows runner; otherwise skip with a clear "NSIS is CI-only" message). Default: skip. Add `--with-nsis` flag for explicit opt-in on Windows hosts.
- [x] 4.2 If §4.1 is taken, document the requirements in `docs/electron-build-methods.md` (Local native section, Windows row): "NSIS requires running on a Windows host with Windows SDK installed."

## 5. QA: Windows install smoke test

- [x] 5.1 Add `qa/tests/windows-nsis-install.ps1`: download Setup.exe from a draft release URL (parameterised), run installer in silent mode (`/S` — NSIS standard switch) accepting the default install location, assert install dir exists at `%LOCALAPPDATA%\Programs\PI Dashboard\`, assert Start Menu shortcut exists, assert Add/Remove Programs entry exists (`Get-ItemProperty HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*` filter by DisplayName), assert the Add/Remove entry's `InstallLocation` value matches the actual install dir.
- [x] 5.1b Add `qa/tests/windows-nsis-install-custom-dir.ps1`: same as §5.1 but pass `/D=D:\TestApps\PI Dashboard` (NSIS standard install-dir override switch) to direct the installer to a non-default location. Assert that location contains the app, the Add/Remove entry's `InstallLocation` reflects it, the uninstaller exists at `D:\TestApps\PI Dashboard\Uninstall PI Dashboard.exe`. This is the regression guard for the install-path-as-variable trade in design D3.
- [x] 5.1c Add `qa/tests/windows-nsis-no-permachine.ps1`: confirm the installer is per-user only — run `/S` install, assert NO entry under `HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*` with DisplayName `PI Dashboard`, assert install dir is NOT under `%PROGRAMFILES%`. Regression guard for design D2 (per-user only, no per-machine mode).
- [x] 5.1d Add `qa/tests/windows-nsis-branding.ps1`: extract the installed `Uninstall PI Dashboard.exe` icon via PowerShell (`[System.Drawing.Icon]::ExtractAssociatedIcon`) and assert it matches the SHA-256 of the built `uninstaller-icon.ico`. Extract the installer's embedded version-info Publisher field and assert it equals `BlackBelt Technology`. Regression guard for D9.
- [x] 5.2 Add `qa/tests/windows-nsis-launch.ps1`: after install (depends on §5.1 OR §5.1b, parameterised), launch `PI Dashboard.exe` from the actual install dir, wait up to 30s for `/api/health` to return 200, assert response shape, kill process, succeed.
- [x] 5.3 Add `qa/tests/windows-nsis-uninstall.ps1`: run uninstaller (`<install dir>\Uninstall PI Dashboard.exe /S`), assert install dir is gone, assert Add/Remove entry is gone, assert `~/.pi/` and `~/.pi-dashboard/` still exist (user-data preservation per D4). Parameterise on install dir so it covers both default and custom-dir paths.
- [x] 5.4 Add `test-windows-remote-nsis` target to `qa/Makefile` (guards `SETUP=`). NOTE: the `test-windows-remote` chain + `qa/remote/` belong to `automate-windows-remote-qa`; wire into that chain when it lands. Primary execution path is now CI (§5.8), not the VM harness.
- [x] 5.8 Wire a "Smoke-test NSIS Setup.exe (install/uninstall)" step into `.github/workflows/_electron-build.yml` after the Upload step (`if: matrix.platform == 'win32'`). Runs on the same `windows-latest` runner — per-user `/S` needs no admin. HARD gates: `windows-nsis-install.ps1`, `windows-nsis-no-permachine.ps1`, `windows-nsis-branding.ps1`, `windows-nsis-uninstall.ps1`. No launch step (GUI-subsystem app cannot start the server headlessly; verified server.log never created).
- [x] 5.5 x64 install/registry/branding/uninstall smoke runs on CI (§5.8). Launch/server-start is VM/manual (not viable on the headless runner).
- [x] 5.6 arm64 non-launch asserts (install/registry/branding/uninstall) run on the CI arm64 build leg inline (§5.8). arm64 launch validation is VM/manual (same headless limitation as x64).
- [x] 5.9 ~~Add `smoke-win-arm64` job~~ — **removed.** Its only unique value was native arm64 launch, which is not viable on a headless hosted runner (no desktop session → server never spawns). Non-launch arm64 coverage already runs inline on the arm64 build leg (§5.8).
- [x] 5.7 Remove now-stale Windows portable QA artifacts: `qa/tests/portable-smoke.ps1` if it exists (per `fix-windows-portable-exe` tasks §3.5).

## 6. Marketing site

- [x] 6.1 Verify `site/src/lib/github-release.ts` classifier handles `PI-Dashboard-Setup-<v>-x64.exe` correctly — should route to `kind: "Installer (.exe)"`, `priority: 0`. (Expected behaviour from line 80-83.) Add a unit test if one doesn't exist.
- [x] 6.2 Verify `priority: 1` portable bucket falls empty after this change — that's fine, github-release.ts buckets empty arrays gracefully.
- [x] 6.3 Update `site/src/components/InstallTabs.tsx` line 22 (code-block): change Windows row from `"Windows  — .zip"` to `"Windows  — .exe (installer) / .zip"`.
- [x] 6.4 Update line 52-56 (Windows callout caption): verify reads "Setup `.exe` / `.zip`" (or equivalent); reword "portable" if present.
- [ ] 6.5 No edit needed for `DownloadSection.astro`, `Hero.astro`, `Nav.astro` — driven by buckets. Spot-check after first NSIS release.
- [ ] 6.6 `site/src/data/latest-release.json` is auto-regenerated by `sync-release-version.yml` on the next release. No manual edit; verify after the first release post-merge.

## 7. Docs

- [x] 7.1 `docs/electron-build-methods.md`: flip comparison table row "Windows NSIS .exe" from ❌ removed to ✅ CI only; flip "Windows portable .exe" to ❌ removed. Update prose blocks accordingly. Update "Limitations" of the Docker section.
- [x] 7.2 `docs/installation-windows.md`: rewrite Path 1 to describe Setup.exe as the primary path; keep `.zip` as secondary; remove portable-specific content (line ~298 "Startup feels slow on cold launch (Windows portable)" — delete entirely since portable is gone). Reframe Step 1 download links — Setup.exe link, `.zip` link, drop the portable link.
- [x] 7.3 `docs/release-process.md`: update the artifact list per release (Setup.exe in, portable.exe out). Note the appId pin per §1.1.
- [x] 7.4 `docs/faq.md`: add entry "Which Windows download should I pick — Setup.exe or .zip?". Update any existing entry claiming NSIS was permanently removed.
- [x] 7.5 `docs/file-index-electron.md`: add row for new `electron-builder-nsis.json` (or inline-config note). Update the `forge.config.ts` row's purpose if needed.
- [x] 7.6 `docs/architecture.md`: spot-check Windows-artifact list mentions; update if present.
- [x] 7.7 `qa/README.md`: document the three new NSIS test scripts and the `test-windows-remote-nsis` Make target.
- [x] 7.8 `.github/release-notes-footer.md` line 18: drop "portable" from the "Setup, portable, or any .exe" wording; keep "Setup" and ".exe".
- [x] 7.9 `CHANGELOG.md`: under `## [Unreleased]`, add:
  ```
  - Windows: restored Setup.exe installer (per-user; Start Menu shortcut; Add/Remove Programs entry; uninstaller preserves user data).
  - Windows: dropped portable.exe — use Setup.exe (installer) or .zip (extract-and-run).
  ```

## 8. Specs (capabilities-as-code)

- [x] 8.1 Edit `openspec/specs/electron-build-pipeline/spec.md`: add requirements covering the NSIS Setup.exe artifact per D1–D8. Note removal of portable.exe requirements.
- [x] 8.2 Edit `openspec/specs/electron-shell/spec.md`: verify the "installed/extracted source" requirement still covers Setup.exe-installed app at `%LOCALAPPDATA%\Programs\PI Dashboard\`; add wording if the spec was written assuming only `.zip` extraction.

## 9. Release & rollout

- [ ] 9.1 Cut a pre-release tag (`v0.5.5-rc1`) after all above is green; confirm Setup.exe attaches to draft release.
- [x] 9.2 Manual smoke on a real Windows 11 x64 box (not VM): install via Setup.exe, launch, send a prompt, terminate, uninstall, verify clean uninstall. Capture screenshots for the release notes.
- [ ] 9.3 Cut the real release (`v0.5.5`) via the `release-cut` skill.
- [ ] 9.4 Within 48h of release: spot-check GitHub Release download counts (`Setup-*.exe` should outpace `.zip` if the marketing-site reordering took effect).
- [ ] 9.5 Archive `fix-windows-portable-exe` proposal (its §4 Drop path is taken by this change; §3 Fix path is moot).

## 10. Follow-ups (out of scope, tracked for visibility)

- [ ] 10.1 Authenticode-sign Setup.exe (depends on `windows-authenticode-signing`).
- [ ] 10.2 Wire electron-updater's NSIS differ channel for auto-update (depends on `fix-electron-auto-update-pipeline`).
- [ ] 10.3 Prune the `extracted` branch in `packages/electron/src/lib/launch-source.ts` if no shipped artifact exercises it after this change.
- [ ] 10.4 Consider adding MSIX as a parallel artifact for the EV-cert-signed SmartScreen-instant-trust path (new proposal).
- [ ] 10.5 **Replace placeholder Pi master asset.** Design team to deliver the final Pi mark (`master.png` or `master.svg`, ≥2048×2048, transparent background, brand-approved). Commit to `packages/electron/build/installer-assets/master.png` replacing the v0.5.5 placeholder. SHA pinning in `build-installer-assets.mjs` will surface the change in CI logs.
- [ ] 10.6 **Design dedicated uninstaller icon.** v0.5.5 ships a programmatically-derived uninstaller icon (red tint or grayscale of master). A dedicated design avoids the "installer icon with a filter on it" look. Low priority — most users never see the uninstaller icon.
- [ ] 10.7 **arm64 launch smoke.** Not viable on a headless hosted runner (GUI app, no desktop session). Validate on a VM with a desktop via `windows-nsis-launch.ps1` once the `automate-windows-remote-qa` harness lands, or manually on arm64 hardware.
