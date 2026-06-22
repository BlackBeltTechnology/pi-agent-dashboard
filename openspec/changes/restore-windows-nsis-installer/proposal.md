## Why

Today the Windows distribution surface is two artifacts per arch — `PI-Dashboard-win32-<arch>.zip` and `PI-Dashboard-<arch>-portable.exe` — and **neither serves the "I installed an app and want a Start Menu entry plus an uninstaller" path** that ordinary Windows users expect.

- The `.zip` works reliably but produces no Start Menu shortcut, no Add-or-Remove-Programs entry, and no uninstaller. Users must remember where they extracted the app and delete the folder manually to uninstall. Discoverability is poor.
- The `portable.exe` (7-Zip SFX) is broken in the field on v0.5.0 — it either silently fails or is blocked by SmartScreen before extracting. The active `fix-windows-portable-exe` proposal is investigating whether to fix or drop it. This proposal makes the **drop** decision unambiguous on independent grounds: the portable target has accumulated three structural problems (SFX path drift across launches, SmartScreen-blocked unsigned SFX, ephemeral `%LOCALAPPDATA%\Temp\<random>\` working dir at odds with the per-user managed-dir bootstrap model) and the use case it occupies ("single-file runner") is fully covered by the `.zip` for users who don't want a real installer.

The archived `simplify-electron-bootstrap-derived-state` removed the NSIS installer in v0.5.0 on four grounds, three of which are now stale:

| Original rationale | Status in 2026 |
|---|---|
| Cross-build needs Wine | ⚠️ Defused — CI already runs `windows-latest` matrix legs for `.zip` + portable; NSIS on a Windows runner needs zero Wine. |
| Redundant with `.zip` + portable | ❌ Invalidated — portable is broken; `.zip` alone doesn't offer shortcuts or uninstaller. |
| Bespoke config (productName/appId/shortcutName pinning) | ✅ Still true, but small one-time cost; the D2 knobs from `fix-electron-windows-installer-and-server-bootstrap` are well-documented now. |
| Architecturally at odds with `~/.pi-dashboard/` managed-dir model | ⚠️ Partially true — only the *machine-wide* (Program Files) variant clashes. Per-user NSIS (`oneClick: false`, `perMachine: false`) installs to `%LOCALAPPDATA%\Programs\PI Dashboard\` and fits the managed-dir model cleanly. |

This change restores a **per-user NSIS Setup.exe** as the primary Windows distribution, drops the broken portable.exe entirely, and keeps the `.zip` as a developer-friendly fallback.

## What Changes

### Restore NSIS Setup.exe (built on CI windows-latest legs, x64 + arm64)

- Use **`electron-builder --win nsis`** as the NSIS toolchain, **extended with a custom include script** at `packages/electron/build/installer.nsh` for Pi branding (per-user installer; no install-mode wizard page). electron-builder is already a devDependency (currently invoked for the now-dropped portable target); same tool, one more target, plus one new `.nsh` include file. The custom include extends electron-builder's generated NSIS script via the documented `nsis.include` config option — we do NOT replace the generated script (that would forfeit electron-version pinning, asar packaging, and updater hooks we get for free).
- Wizard UX (MUI2 modern interface, modelled on the JUDO designer's `install.nsi` reference but upgraded from the classic `sdbarker_tiny` UI to NSIS Modern UI 2):
  1. **Welcome page** — Pi-branded welcome bitmap (164×314 BMP).
  2. **Choose Install Location page** — editable path field, pre-filled with the per-user default `%LOCALAPPDATA%\Programs\PI Dashboard\`. No install-mode page — this is a per-user-only installer.
  3. **Install progress page**.
  4. **Finish page** — Pi-branded finish bitmap, "Launch PI Dashboard" checkbox (default checked).
- Branding assets (D9 in design.md): custom installer icon, uninstaller icon, MUI2 welcome/finish bitmap (164×314), MUI2 header bitmap (150×57), branding text "BlackBelt Technology — PI Dashboard". Sources live under `packages/electron/build/installer-assets/`; the build pipeline derives ICO + BMP from a Pi master asset.
- UAC elevation: per-user install — no UAC prompt; install proceeds as the current user. (If the user redirects the install dir to a system-protected location such as `C:\Program Files\`, electron-builder's NSIS auto-elevates for that copy step only — standard Windows behaviour, documented. This is the only elevation path; there is no per-machine install mode.)
- Registry behaviour (modelled on the JUDO `WriteRegStr ...Uninstall\$APPNAMEFULL` pattern):
  - Add/Remove Programs entry under `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\PI Dashboard`.
  - Entry fields: DisplayName `PI Dashboard`, Publisher `BlackBelt Technology`, DisplayVersion = release version, DisplayIcon = path into install dir, UninstallString + QuietUninstallString = uninstaller path, InstallLocation = actual chosen install dir, EstimatedSize, NoModify=1, NoRepair=1 (mirroring the JUDO reference's registry shape).
- Shortcut creation: Start Menu shortcut named `PI Dashboard` under the user's per-profile Start Menu (`$SMPROGRAMS`). Desktop shortcut optional, default off.
- Uninstaller behaviour: removes install dir; **preserves** `~/.pi/` and `~/.pi-dashboard/` (user data). Models the JUDO selective-uninstall pattern — explicit `RMDir /r` on app-owned subdirs only. Final uninstaller page shows a notice that user data has been preserved and how to remove it manually.
- Artifact name: `PI-Dashboard-Setup-<version>-<arch>.exe` (matches the classifier already in `site/src/lib/github-release.ts`, line 80-83 — no marketing-site code change required).

### Drop portable.exe entirely

- Remove the `npx electron-builder --win portable …` invocation from `.github/workflows/_electron-build.yml` (line ~444-452).
- Remove the equivalent step from `packages/electron/scripts/docker-make.sh` (line ~224-253) and `packages/electron/scripts/build-windows-zip.sh` (step 7, line ~183-200).
- Remove the `--no-portable` flag plumbing from `build-installer.sh` and `build-windows-zip.sh`.
- Remove `electron-builder` from `packages/electron/package.json` **only if** no other target consumes it. (It is consumed by this proposal for `--win nsis`, so it stays — but the unused `portable` config block in any electron-builder config file should be deleted.)
- Update the active `fix-windows-portable-exe` proposal: its "Drop path" (§4 of `tasks.md`) is subsumed by this change. Archive `fix-windows-portable-exe` once this lands; document the closure in its tasks.

### Keep `.zip` unchanged

- `PI-Dashboard-win32-x64.zip` and `PI-Dashboard-win32-arm64.zip` continue to build and ship exactly as today. Use case: power users, CI consumers, "just give me the files" workflow.

### Smoke-test Setup.exe on CI (same `windows-latest` runner)

- The `windows-latest` legs that build Setup.exe are real Windows machines, so the installer is smoke-tested **inline as a workflow step right after the build** — no VM, no `automate-windows-remote-qa` harness, no `qa/remote/` dependency. Per-user `/S` install needs no admin/UAC, so it runs unprivileged on the runner.
- Hard gates (deterministic, offline, fail the job): `windows-nsis-install.ps1` (default-path `/S` install → install dir, Start Menu shortcut, HKCU Add/Remove entry with matching `InstallLocation` + Publisher), `windows-nsis-no-permachine.ps1` (no HKLM entry, not under Program Files), `windows-nsis-branding.ps1` (Publisher version-info + uninstaller icon), `windows-nsis-uninstall.ps1` (removes app, preserves `~/.pi/` + `~/.pi-dashboard/`).
- **Launch / server-start is NOT smoke-tested on the build runner.** `pi-dashboard.exe` is a GUI-subsystem binary and GitHub-hosted runners have no interactive desktop session, so the Electron main process never reaches the server-spawn step (verified: process stays alive, `~/.pi/dashboard/server.log` never created, stdout/stderr empty). A runner launch assertion only ever times out — it was tried (non-fatal x64 step + a `windows-11-arm` `smoke-win-arm64` job) and **removed** as misleading.
- Launch / server-start validation runs **off the build runner**: on a VM with a desktop via `qa/tests/07-electron-bootstrap-v2.ps1` + `windows-nsis-launch.ps1` (the `automate-windows-remote-qa` harness, `make test-windows-remote-nsis SETUP=…`), or by manual install. This is also the authoritative test for the nodejs#58515 Node-version fix (#136).
- The same `windows-nsis-*.ps1` scripts run inline on CI (install/uninstall) and under the VM harness (full launch) — no duplicate test logic.

### Per-release artifact list (Windows)

| | Before (v0.5.4) | After |
|---|---|---|
| Setup.exe x64 | ❌ | ✅ `PI-Dashboard-Setup-<v>-x64.exe` |
| Setup.exe arm64 | ❌ | ✅ `PI-Dashboard-Setup-<v>-arm64.exe` |
| portable.exe x64 | ⚠️ broken | ❌ removed |
| portable.exe arm64 | ⚠️ broken | ❌ removed |
| .zip x64 | ✅ | ✅ unchanged |
| .zip arm64 | ✅ | ✅ unchanged |

### Files affected

**Build pipeline:**
- `.github/workflows/_electron-build.yml` — line 4 (header comment); line ~309-315 (keep the "skip forge make on Windows" guard — NSIS is produced by electron-builder, not Forge); the win32 build step (rename to "Build Windows ZIP and NSIS Setup.exe"; replace portable invocation with `node scripts/build-installer-assets.mjs` + `npx electron-builder --win nsis --config electron-builder-nsis.json`); NEW "Smoke-test NSIS Setup.exe (install/uninstall)" step after the Upload step (win32-only): runs `qa/tests/windows-nsis-{install,no-permachine,branding,uninstall}.ps1` as HARD gates. No launch step on the runner (GUI app cannot start the server headlessly); launch validation is VM/manual.
- `packages/electron/forge.config.ts` — leave Forge makers as-is; NSIS is produced by electron-builder, mirroring how portable was produced.
- `packages/electron/package.json` — no change (electron-builder already a devDependency).
- `packages/electron/scripts/build-installer.sh` — header comment (line 17-19), usage text (line 83-84), summary line (line 163).
- `packages/electron/scripts/docker-make.sh` — remove portable block (line ~224-253); NSIS is **not** added to the Docker path (requires Windows host); document Docker as ZIP-only for Windows.
- `packages/electron/scripts/build-windows-zip.sh` — drop portable step 7; add NSIS step gated on Windows host or skipped with a clear "NSIS is CI-only" message when run outside Windows. Add `--no-nsis` and `--with-nsis` flags.
- **NEW** `packages/electron/electron-builder-nsis.json` — electron-builder config for the NSIS target: `appId: "hu.blackbelt.pi-dashboard"`, `productName`, `oneClick: false`, `perMachine: false` (per-user only), `allowToChangeInstallationDirectory: true`, `allowElevation: true` (auto-elevate only when the user targets a protected dir), `include: "build/installer.nsh"`, `installerIcon`, `uninstallerIcon`, `installerHeader`, `installerSidebar`, `uninstallerSidebar`, `artifactName`, `shortcutName: "PI Dashboard"`, `uninstallDisplayName: "PI Dashboard"`, `deleteAppDataOnUninstall: false`. (Publisher `BlackBelt Technology` is written by `installer.nsh` — `publisherName` is not a valid electron-builder 26 `win`/`nsis` field.)
- **NEW** `packages/electron/build/installer.nsh` — custom NSIS include extending electron-builder's generated script. Adds: branding text (`BrandingText`); welcome/finish bitmap declarations (`MUI_WELCOMEFINISHPAGE_BITMAP`, `MUI_UNWELCOMEFINISHPAGE_BITMAP`); header bitmap (`MUI_HEADERIMAGE_BITMAP`); customised registry-write helpers if electron-builder's defaults don't cover `DisplayIcon` / `NoModify` / `NoRepair` (modelled on JUDO's `WriteRegStr "...Uninstall\$APPNAMEFULL" "DisplayIcon" ...` pattern, written to HKCU here); selective-uninstall hook preserving `~/.pi/` and `~/.pi-dashboard/`. Helper functions (`StrContains`, `DeleteDirIfEmpty`) imported verbatim from the JUDO reference where useful.
- **NEW** `packages/electron/build/installer-assets/`:
  - `installer-icon.ico` — multi-resolution Pi-branded ICO (16/24/32/48/64/128/256).
  - `uninstaller-icon.ico` — same resolutions, visually differentiated.
  - `welcome-banner.bmp` — 164×314 MUI2 welcome + finish bitmap.
  - `header-banner.bmp` — 150×57 MUI2 page header bitmap.
  - `master.png` (or `master.svg`) — Pi source asset, checked in, used by the derivation script.
- **NEW** `packages/electron/scripts/build-installer-assets.mjs` — Node script deriving ICO + BMP from the master asset (sharp + png-to-ico, both already-or-easily available). Run as part of the NSIS build step (or pre-step) on the CI Windows leg. Outputs to `packages/electron/build/installer-assets/` for `electron-builder-nsis.json` to consume.

**Release infrastructure:**
- `.github/release-notes-footer.md` — line 5 ("Windows installers and macOS DMGs are not yet code-signed"): already accurate, no change. Line 18 ("Setup, portable, or any .exe"): drop "portable", keep "Setup".
- `site/src/data/latest-release.json` — auto-regenerated by `sync-release-version.yml`. No manual edit; just becomes `[..., Setup-x64.exe, Setup-arm64.exe, ...]` on first release after merge.
- `site/src/lib/github-release.ts` — **classifier already handles it** (line 80-83 routes `.exe` + "setup" to priority 0 / "Installer (.exe)"; portable `.exe` was priority 1, will simply disappear from the bucket). No code change.
- `site/src/components/InstallTabs.tsx` — line 22 (code block listing): add ".exe (installer)" to Windows row. Line 52-56 (caption): verify wording reads "installer or `.zip`" rather than "portable or `.zip`".
- `site/src/components/DownloadSection.astro` — driven by github-release.ts buckets; picks up Setup.exe automatically. No edit needed.

**Docs:**
- `docs/electron-build-methods.md` — comparison table row "Windows NSIS .exe": flip from ❌ removed to ✅ CI only (`windows-latest`). Row "Windows portable .exe": flip to ❌ removed. Update prose paragraphs accordingly.
- `docs/installation-windows.md` — Path 1 section already references `PI-Dashboard-<version>-Setup.exe` (stale wording from before v0.5.0 removal!); this change makes the doc match reality. Reframe two paths: 1a Setup.exe, 1b `.zip`. Remove portable-specific troubleshooting (line 298 "Startup feels slow on cold launch (Windows portable)").
- `docs/release-process.md` — update artifact list per release.
- `docs/faq.md` — add entry "Why two Windows downloads? Setup.exe vs `.zip`?". Update or remove any entry claiming NSIS is gone.
- `docs/file-index-electron.md` — update `forge.config.ts` row (no change to makers, but note NSIS produced via electron-builder sidecar); add row for new `electron-builder-nsis.json` if created.
- `docs/architecture.md` — verify no stale Windows-artifacts list; update if present.
- `qa/README.md` — document the NSIS smoke scripts. Primary execution is inline on the `windows-latest` CI leg (post-build step in `_electron-build.yml`); the same scripts also run under the `automate-windows-remote-qa` VM harness via `make test-windows-remote-nsis` once it lands.
- `CHANGELOG.md` — under Unreleased: "Windows: restored Setup.exe installer (per-user, Start Menu shortcut, Add/Remove Programs entry, uninstaller). Dropped broken portable.exe."

**Specs:**
- `openspec/specs/electron-build-pipeline/spec.md` — restore NSIS-related requirements (removed by `simplify-electron-bootstrap-derived-state`) updated for the per-user model and the electron-builder toolchain choice.

**Cross-proposal coordination:**
- `openspec/changes/fix-windows-portable-exe/` — mark its §2.2 "Drop path" as taken by this proposal; archive once both land.
- `openspec/changes/windows-authenticode-signing/` — signing is composable with this change. Setup.exe benefits from Authenticode signing (SmartScreen reputation, instant trust with EV cert) but does not require it to function. This proposal does not gate on signing.
- `openspec/changes/fix-electron-auto-update-pipeline/` — that proposal's line about "unsigned NSIS update path" becomes relevant again. Auto-update wiring for NSIS is out of scope for this change but unblocked by it.

## Capabilities

### Modified Capabilities

- `electron-build-pipeline`: produce a NSIS `Setup.exe` artifact per Windows arch on CI `windows-latest` legs via `electron-builder --win nsis` extended with a custom `installer.nsh` include for Pi branding. The installer is **per-user only** (`perMachine: false`, no install-mode page, no per-machine variant). Setup.exe MUST present a wizard that (1) lets the user choose the install directory (defaulting to `%LOCALAPPDATA%\Programs\PI Dashboard\`), (2) creates a per-user Start Menu shortcut, (3) registers an Add/Remove Programs entry under HKCU with publisher/version/`InstallLocation`/`DisplayIcon`/`NoModify`/`NoRepair` populated, and (4) includes an uninstaller that removes the install dir but preserves `~/.pi/` and `~/.pi-dashboard/`. The installer MUST display Pi-branded installer icon, welcome/finish bitmap, header bitmap, and branding text `BlackBelt Technology — PI Dashboard`. The `appId` SHALL be `hu.blackbelt.pi-dashboard` and SHALL NOT change once the first NSIS release has shipped. The `portable.exe` (7-Zip SFX) target is removed from the pipeline (`_electron-build.yml`, `docker-make.sh`, `build-windows-zip.sh`).
- `electron-shell`: continue to launch correctly from **any** install directory the user chose (no hardcoded install-path assumptions). The bootstrap resolves the running install location via `app.getPath('exe')` and `process.resourcesPath`, so the existing `selectLaunchSource()` resolver SHALL keep working for default `%LOCALAPPDATA%\Programs\PI Dashboard\` installs and for user-chosen paths like `D:\MyApps\PI Dashboard\` alike. A verification task (see tasks §2.6) confirms no hardcoded paths remain.

### Removed Capabilities

- The 7-Zip SFX `portable.exe` Windows distribution. No replacement; affected users switch to Setup.exe (installer experience) or `.zip` (extract-and-run).

## Non-goals

- Code-signing the NSIS Setup.exe — composable with `windows-authenticode-signing`; not required for this change to ship. Without signing, users see the same SmartScreen prompt as today's `.zip` + Run anyway.
- Auto-update via electron-updater's NSIS channel — wiring belongs in `fix-electron-auto-update-pipeline`.
- Machine-wide / per-machine NSIS variant (HKLM registration, Program Files default, install-mode wizard page) — explicitly out of scope. Setup.exe is per-user only. A corporate/shared-workstation install can use the `.zip`. Revisit only if there is concrete demand.
- MSIX installer — deferred (requires mandatory signing and may conflict with node-pty sandbox).
- Microsoft Store submission — out of scope.
- Reviving NSIS in the Docker cross-build path — Docker remains ZIP-only for Windows. NSIS is a CI-only artifact (`windows-latest` runner).
- Fixing or restoring `portable.exe` — explicitly dropped by this change.
