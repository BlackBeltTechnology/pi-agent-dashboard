# Tasks

## 1. Spike — verify `bundle-server.mjs --source-only`  — ✓ DONE (2026-05-25)

- [x] 1.1 Authored `packages/electron/scripts/spike-source-only-bundle.sh`: non-destructive Docker-based probe with backup/restore via `trap`, structural assertions, and harness handoff.
- [x] 1.2 Ran the spike against `node:24-bookworm-slim`. Structural pass: bundle produces, `npm install --omit=dev` in-container succeeds, `@blackbelt-technology/*` workspaces materialise from local source.
- [x] 1.3 Cross-checked: full (non-source-only) bundle exhibits identical post-install state. `--source-only` is not a regression vector.
- [x] 1.4 Recorded result in `design.md` Decision 3 "Spike result" table. `source_only_bundle: true` is the CI default.
- [x] 1.5 Fixed two pre-existing bugs in `test-server-launch.sh` that surfaced during the spike (orphan `COPY dist`; hardcoded `-it`). These were latent against the current bundle layout and would have blocked any future investigation of either mode.
- [x] 1.6 Added Test 8 (jiti boot + `/api/health` probe) to `test-server-launch.sh` as the load-bearing harness verdict. Empirically confirmed: server reaches `/api/health` 200 within 12 s in a clean `node:24-bookworm-slim` container.

## 2. Extract reusable workflow

- [ ] 2.1 Create `.github/workflows/_electron-build.yml` with `on: workflow_call` and the input contract from design.md Decision 2.
- [ ] 2.2 Move the entire body of `publish.yml`'s `electron` job into the reusable workflow, parameterising `version`, `ref`, `legs`, `source_only_bundle`, `artifact_retention_days`.
- [ ] 2.3 Implement the per-leg `if:` guard that consumes the `legs` input. Supported values: `all`, `darwin`, `linux`, `win32`, and comma-lists like `darwin-arm64,linux-x64`.
- [ ] 2.4 Verify the reusable workflow is syntactically valid via `actionlint .github/workflows/_electron-build.yml` (or `gh workflow view` after push).

## 3. Refactor `publish.yml` to consume the reusable workflow

- [ ] 3.1 Replace the `electron:` job body with a `uses: ./.github/workflows/_electron-build.yml` reference plus `with:` block.
- [ ] 3.2 Keep `needs: [prepare, publish]` exactly as-is — this is the registry-availability gate the existing comment + lint protect.
- [ ] 3.3 Update `packages/shared/src/__tests__/publish-workflow-contract.test.ts` to assert: (a) the `uses:` reference, (b) `needs: [prepare, publish]` is preserved, (c) `fail-fast: false` survives into the reusable workflow.
- [ ] 3.4 Smoke-test: re-run the release pipeline on a throwaway tag (`v0.0.0-test.1`) and confirm artifact set is bit-for-bit identical to the pre-refactor baseline (same DMG/AppImage/etc filenames, same matrix legs).

## 4. Add `ci-electron.yml`

- [ ] 4.1 Create `.github/workflows/ci-electron.yml` with `on: workflow_dispatch` and inputs: `legs` (string, default `all`).
- [ ] 4.2 Implement the version-slug resolver job that computes `<base>-ci.<UTC-stamp>.<branch-slug>.<sha7>`. Sanitiser: replace `[^a-zA-Z0-9.-]` with `-`, truncate to 20, strip leading/trailing `.` and `-`. Validate against the SemVer regex used by `publish.yml`.
- [ ] 4.3 Surface the resolved slug, branch, and sha7 in `GITHUB_STEP_SUMMARY` so the dispatcher can copy/paste them.
- [ ] 4.4 Call `_electron-build.yml` via `uses:` with `source_only_bundle: true`, `ref: ${{ github.sha }}`, `legs: ${{ inputs.legs }}`, `artifact_retention_days: 14`.
- [ ] 4.5 Add the concurrency group `ci-electron-${{ github.ref }}` with `cancel-in-progress: true`.

## 5. Safety lints

- [ ] 5.1 Add a repo lint test (`packages/shared/src/__tests__/ci-electron-no-side-effects.test.ts`) that scans `ci-electron.yml` and fails if it contains any of: `softprops/action-gh-release`, `actions/create-release`, `npm publish`, `git tag`, `git push origin v`.
- [ ] 5.2 Add an assertion to the same test that `_electron-build.yml` is purely an artifact producer — no `softprops/action-gh-release`, no `npm publish` inside the reusable workflow body either. Release/publish stay in the callers.

## 6. Documentation

- [ ] 6.1 Update `README.md` (or `docs/` split) with a "Build a one-off Electron installer" section pointing at the `ci-electron` workflow's "Run workflow" UI.
- [ ] 6.2 Add a `docs/file-index-*.md` row for `.github/workflows/_electron-build.yml` and `.github/workflows/ci-electron.yml` (via subagent, per AGENTS.md Documentation Update Protocol caveman-style rule).
- [ ] 6.3 Add a `docs/faq.md` entry: "How do I get an installer for a feature branch without cutting a release?" → dispatch `ci-electron`, download from the run page's Artifacts section.

## 7. Verification

- [ ] 7.1 Dispatch `ci-electron` on `develop` with `legs: linux-x64` (cheap). Confirm: artifact appears, downloadable from Actions UI, contains an AppImage that installs in a clean `ubuntu:24.04` container via `test-electron-install.sh` and reaches `GET /api/health` 200. (The source-bundle harness in task 1 already validates boot via `Test 8`; task 7.1 validates the full Electron-packaged artifact path end-to-end.)
- [ ] 7.2 Dispatch `ci-electron` on a `feature/*` branch with `legs: all`. Confirm: branch slug appears in version, all 6 legs upload, no Release created, no npm version published.
- [ ] 7.3 Confirm an installed dev's Electron app (running the previous stable) does NOT receive an auto-update prompt after the CI dispatch completes. (Manual check — open the app, wait 90s past the initial-check timer, verify no update dialog.)
- [ ] 7.4 Re-run the release pipeline against a real tag and confirm end-to-end parity with the pre-refactor baseline.
