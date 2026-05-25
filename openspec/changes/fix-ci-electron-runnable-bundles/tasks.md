# Tasks

## 1. Spike — confirm workspace resolution without `--source-only` in CI

> **Human-gated.** Requires GitHub workflow dispatch, artefact download, and clean Windows/Linux/macOS VMs. The implementation tasks (§2-§5) have landed first per user instruction — spike must complete BEFORE merging this branch to `main`. If any spike leg fails, revert tasks §2-§3 or land a sync-versions.js fix before merge.

- [ ] 1.1 On a feature branch, edit `.github/workflows/ci-electron.yml` to pass `source_only_bundle: false`. Do not commit; use this branch only for the spike dispatch.
- [ ] 1.2 Manual-dispatch `ci-electron.yml` with `legs: win32-x64` only. Cheapest single-leg signal because the reported failure (`BundledServerMissingError`) is Windows-specific in user reports.
- [ ] 1.3 Download the resulting artifact, unzip on a clean Windows VM, launch the .exe.
- [ ] 1.4 Pass criteria:
  - `resources/server/node_modules/@blackbelt-technology/pi-dashboard-server/src/cli.ts` exists in the unzipped tree.
  - No symlinks remain under `resources/server/node_modules/@blackbelt-technology/` (verify via PowerShell `Get-ChildItem -Force | Where-Object { $_.LinkType }`).
  - Electron launches without the "Bundled Server Missing" dialog.
  - `/api/health` returns 200 within 30 s of clicking "Launch dashboard" in the wizard.
- [ ] 1.5 Repeat 1.2-1.4 for `legs: linux-x64` and `legs: darwin-arm64` (one each, to cover the three OS install paths). Skip arm64-Windows + linux-arm64 + darwin-x64 — they share install logic with their siblings; cost of three additional legs not justified.
- [ ] 1.6 If any leg fails: capture the `npm install` log tail, the `bundle-server.mjs` GO/NO-GO output, and the absent path. Diagnose before flipping the flag in `main`. Most likely failure mode: a workspace cross-ref still references a registry-only version → fix in `scripts/sync-versions.js` first as a precursor change.
- [ ] 1.7 Record spike results in `design.md` (create if needed) with the exact dispatch run URLs and a per-leg PASS/FAIL table.

## 2. Flip `source_only_bundle` for CI dispatches

- [x] 2.1 Edit `.github/workflows/ci-electron.yml`: `source_only_bundle: true` → `false`. Update the inline comment block to reflect the new contract.
- [x] 2.2 Edit `.github/workflows/_electron-build.yml` "Bundle dashboard server" step comment block to clarify when `--source-only` is appended (only when `inputs.source_only_bundle == true`; only the Docker cross-compile callers still pass it via the dedicated script path, not the workflow input).
- [x] 2.3 Verify the conditional `${{ inputs.source_only_bundle && '--source-only' || '' }}` still produces the empty string when `false` — no orphan whitespace into the argv. Trivially correct but worth eyeballing once.

## 3. Add CI assertion — runnable-bundle invariant

- [x] 3.1 In `_electron-build.yml`, add a step after "Bundle dashboard server" that runs only when `inputs.source_only_bundle == false`. The step asserts:
  - `resources/server/node_modules/@blackbelt-technology/pi-dashboard-server/src/cli.ts` exists.
  - `resources/server/node_modules/@blackbelt-technology/pi-dashboard-server/package.json` exists.
  - The step fails the job with a precise error message naming the missing path and pointing at this OpenSpec change.
- [x] 3.2 Step is Node-native (`node -e "..."`) so it runs identically on Linux/macOS/Windows runners. No `shell: bash` on Windows-reachable steps (`packages/shared/src/__tests__/no-bash-on-windows.test.ts` invariant).
- [x] 3.3 The assertion runs on **all** legs when `source_only_bundle == false`, both for `ci-electron.yml` and `publish.yml`. It is intentionally redundant with the release-flow's existing post-install sanity (`bundle-server.mjs:273` GO/NO-GO on node-pty prebuilds) — they cover different paths.

## 4. Update `publish-workflow-contract.test.ts`

- [x] 4.1 Extend the lint test to assert `ci-electron.yml` passes `source_only_bundle: false`. The earlier version of this same test pinned `true`; the contract has moved.
- [x] 4.2 Add a sibling assertion: the reusable `_electron-build.yml` contains a step whose name matches `/runnable[- ]bundle|cli\.ts.*exists/i`, gating future removal of the assertion added in § 3.

## 5. Documentation

- [x] 5.1 Update `ci-electron.yml`'s `GITHUB_STEP_SUMMARY` block — the "Artifacts uploaded to this run page only — no registry side effects, no GitHub Release" line is still accurate, but add: "Artifacts are runnable installers, identical layout to release builds (only the version slug differs)."
- [x] 5.2 Delegate `docs/file-index-electron.md` row update for `_electron-build.yml` (note the new runnable-bundle assertion step) to a general-purpose subagent per AGENTS.md Documentation Update Protocol. **Note**: target file was `docs/file-index-skills-misc.md` (where `.github/workflows/*` rows actually live, not `file-index-electron.md`); two rows updated (rows 34 `_electron-build.yml` + 35 `ci-electron.yml`).

## 6. Validation

> **Human-gated.** Post-merge dispatch + per-OS VM smoke + release cut. Cannot be automated in-session.

- [ ] 6.1 Merge the change. Manually dispatch `ci-electron.yml` once with `legs: all`. All six legs SHALL pass.
- [ ] 6.2 Download each platform artifact, unzip on the matching OS (or a representative VM), launch the .exe / .app / .AppImage / .deb. Each launch SHALL reach `/api/health` 200 from a clean managed dir.
- [ ] 6.3 Confirm CI total wall time stays under 120 min for the six-leg matrix. If it regresses past that, revisit caching of `resources/server/node_modules/` via `actions/cache` — out of scope here but tracked.
- [ ] 6.4 Cut a follow-up release (next regular cut, not forced) and confirm the release flow still produces a runnable installer — no regression in `publish.yml`.
