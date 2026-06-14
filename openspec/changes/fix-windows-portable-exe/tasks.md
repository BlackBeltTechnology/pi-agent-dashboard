## 1. Diagnose

- [ ] 1.1 Reproduce the launch failure on a clean Windows 11 x64 host using `PI-Dashboard-x64-portable.exe` from a v0.5.0 build artifact (rebuild locally if the release asset is gone — `cd packages/electron && bash scripts/build-windows-zip.sh` produces both ZIP and portable). Capture: exit code, stderr, Windows Event Viewer entry under "Application", any visible error dialog, screenshot.
- [ ] 1.2 Repeat on Windows 11 arm64 with `PI-Dashboard-arm64-portable.exe`. Note any divergence from x64.
- [ ] 1.3 Inspect the SFX extraction location at runtime (`Get-Process "PI Dashboard" | Select-Object Path` while the portable is running, or just before it crashes). Confirm whether `app.getPath('exe')` and `process.resourcesPath` resolve to `%LOCALAPPDATA%\Temp\<random>\`.
- [ ] 1.4 Check whether `~/.pi-dashboard/` gets created at all on the first portable launch. If yes, inspect `version.json` / extracted-marker contents — does the path it records still exist after the SFX cleans up?
- [ ] 1.5 Compare with the ZIP path: extract `PI-Dashboard-win32-x64.zip` to `C:\Users\<user>\Apps\pi-dashboard\` and run `PI Dashboard.exe` directly. Confirm the ZIP launches successfully (this is the documented working path). Note any state files the ZIP creates that the portable doesn't.
- [ ] 1.6 Write up findings inline in `design.md` under "Diagnosis" with the captured evidence.

## 2. Decide: fix vs. drop

- [ ] 2.1 Based on §1, classify the root cause: (a) targeted code fix in `launch-source.ts` / `bundle-extract.ts`, (b) electron-builder config fix (asar unpacking, extraResources), (c) fundamental incompatibility with 7-Zip SFX semantics, or (d) AV / SmartScreen (out of scope — needs codesigning).
- [ ] 2.2 Pick path: **Fix** (§3) or **Drop** (§4). Document the call in `design.md` under "Decision".

## 3. Fix path (only if §2.2 selects fix)

- [ ] 3.1 Implement the targeted change. Likely surfaces:
  - `packages/electron/src/lib/launch-source.ts` — `extracted` branch path resolution.
  - `packages/electron/src/lib/bundle-extract.ts` — `needsExtraction` heuristic; survive-extract whitelist.
  - `packages/electron/forge.config.ts` or `electron-builder` portable config — asar unpack list, extraResources.
- [ ] 3.2 Add unit test exercising the fix (mock the SFX-style `app.getPath('exe')` returning a temp path under `%LOCALAPPDATA%\Temp\`).
- [ ] 3.3 Re-build the portable locally; verify it launches on clean Windows x64 + arm64 hosts via `qa/remote/`.
- [ ] 3.4 Wire `qa/Makefile` `test-windows-remote-portable` to actually exercise the portable artifact end-to-end (currently a placeholder per `automate-windows-remote-qa`). Test must POST nothing — only GET `/api/health` — and tear down cleanly.
- [ ] 3.5 Add a `qa/tests/portable-smoke.ps1` invoked by the above target.
- [ ] 3.6 Restore portable to README + site (revert the relevant edits from `docs: remove broken Windows portable .exe from README + site` once verified).

## 4. Drop path (only if §2.2 selects drop)

> **SUBSUMED by `restore-windows-nsis-installer`.** That change drops the
> portable.exe target on independent grounds (replaced by a per-user NSIS
> Setup.exe) and already implements §4.1–§4.7: portable removed from
> `_electron-build.yml`, `docker-make.sh`, `build-windows-zip.sh`
> (`--no-portable`/`ZIP_ONLY` plumbing gone), `build-installer.sh`
> (`--windows-zip` kept as alias), and `electron-builder` retained (now used
> for `--win nsis`). This proposal's Drop path is therefore closed; archive
> `fix-windows-portable-exe` once `restore-windows-nsis-installer` lands.

- [ ] 4.1 Remove the portable build step from `.github/workflows/publish.yml` ("Build Windows ZIP and portable exe" → "Build Windows ZIP"; drop the `npx electron-builder --win portable …` block).
- [ ] 4.2 Remove step 7 ("Building portable .exe (7-Zip SFX)") from `packages/electron/scripts/build-windows-zip.sh` and the `--no-portable` flag plumbing.
- [ ] 4.3 Remove the portable block from `packages/electron/scripts/docker-make.sh` (lines ~200–230) and the `ZIP_ONLY` short-circuit referencing it.
- [ ] 4.4 Drop `--windows-zip` flag from `packages/electron/scripts/build-installer.sh` (only `--windows` remains, now ZIP-only) — or keep both as aliases.
- [ ] 4.5 If `electron-builder` is now unused, remove it from `packages/electron/package.json` devDependencies and delete any leftover `electron-builder.json` config files.
- [ ] 4.6 Update CHANGELOG `## [Unreleased]` with a "Removed: Windows portable .exe target (was broken in 0.5.0, never worked in production)" entry.
- [ ] 4.7 Confirm `qa/Makefile` has no `test-windows-remote-portable` target left, or repoint it to a clear `not-supported` failure with a helpful message.

## 5. Verify

- [ ] 5.1 Run `npm run lint` + `npm test` — must pass.
- [ ] 5.2 Run `npm run electron:build -- --windows` (Docker on macOS, or native on a Windows host) — verify only the expected artifacts land in `packages/electron/out/make/`.
- [ ] 5.3 (Fix path) Run `make test-windows-remote-portable` against a real Windows host; capture passing log.
- [ ] 5.4 Update `docs/file-index-electron.md` if any file responsibility changed (drop path likely simplifies several entries).

## 6. Archive

- [ ] 6.1 Update CHANGELOG `## [Unreleased]` with the user-facing summary.
- [ ] 6.2 `openspec archive fix-windows-portable-exe` once merged.
