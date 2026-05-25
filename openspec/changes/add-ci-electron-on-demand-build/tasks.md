# Tasks

## 1. Spike — verify `bundle-server.mjs --source-only`  — ✓ DONE (2026-05-25)

- [x] 1.1 Authored `packages/electron/scripts/spike-source-only-bundle.sh`: non-destructive Docker-based probe with backup/restore via `trap`, structural assertions, and harness handoff.
- [x] 1.2 Ran the spike against `node:24-bookworm-slim`. Structural pass: bundle produces, `npm install --omit=dev` in-container succeeds, `@blackbelt-technology/*` workspaces materialise from local source.
- [x] 1.3 Cross-checked: full (non-source-only) bundle exhibits identical post-install state. `--source-only` is not a regression vector.
- [x] 1.4 Recorded result in `design.md` Decision 3 "Spike result" table. `source_only_bundle: true` is the CI default.
- [x] 1.5 Fixed two pre-existing bugs in `test-server-launch.sh` that surfaced during the spike (orphan `COPY dist`; hardcoded `-it`). These were latent against the current bundle layout and would have blocked any future investigation of either mode.
- [x] 1.6 Added Test 8 (jiti boot + `/api/health` probe) to `test-server-launch.sh` as the load-bearing harness verdict. Empirically confirmed: server reaches `/api/health` 200 within 12 s in a clean `node:24-bookworm-slim` container.

## 2. Extract reusable workflow

- [x] 2.1 Create `.github/workflows/_electron-build.yml` with `on: workflow_call` and the input contract from design.md Decision 2.
- [x] 2.2 Move the entire body of `publish.yml`'s `electron` job into the reusable workflow, parameterising `version`, `ref`, `legs`, `source_only_bundle`, `artifact_retention_days`. Added `artifact_name_suffix` for CI sha7 traceability.
- [x] 2.3 Implement the per-leg `if:` guard at job level using `inputs.legs == 'all' || inputs.legs == matrix.platform || contains(inputs.legs, format('{0}-{1}', matrix.platform, matrix.arch))`.
- [x] 2.4 YAML parse verified via `yaml` package; workflow contract verified by `publish-workflow-contract.test.ts` (9 tests pass). `actionlint` not installed locally; `gh workflow view` after first push will be the final validator.

## 3. Refactor `publish.yml` to consume the reusable workflow

- [x] 3.1 Replaced lines 265–630 of `publish.yml` (366 lines) with a 15-line `uses: ./.github/workflows/_electron-build.yml` block. File reduced from 715 → 367 lines.
- [x] 3.2 `needs: [prepare, publish]` preserved on the electron job; verified by contract test.
- [x] 3.3 `publish-workflow-contract.test.ts` updated: (a) asserts the `uses:` reference, (b) asserts `needs: [prepare, publish]`, (c) `fail-fast: false` assertion moved to a new `describe('_electron-build.yml — reusable workflow contract')` block with input-contract + no-side-effects checks. All 9 tests pass.
- [ ] 3.4 Smoke-test: re-run the release pipeline on a throwaway tag (`v0.0.0-test.1`) and confirm artifact set is bit-for-bit identical to the pre-refactor baseline. **Manual — requires CI dispatch.**

## 4. Add `ci-electron.yml`

- [x] 4.1 Created `.github/workflows/ci-electron.yml` with `on: workflow_dispatch` and the `legs` input (string, default `all`).
- [x] 4.2 Version-slug `resolve` job implemented with the exact sanitiser from design.md Decision 1. Validates against the same SemVer regex as `publish.yml`.
- [x] 4.3 Run summary includes version, branch, branch slug, commit, and legs in a markdown table.
- [x] 4.4 `build` job delegates to `_electron-build.yml` with `source_only_bundle: true`, `ref: ${{ github.sha }}`, `legs: ${{ inputs.legs }}`, `artifact_retention_days: 14`, `artifact_name_suffix: -${{ needs.resolve.outputs.sha7 }}`.
- [x] 4.5 Concurrency group `ci-electron-${{ github.ref }}` with `cancel-in-progress: true` declared at workflow level.

## 5. Safety lints

- [x] 5.1 Added `packages/shared/src/__tests__/ci-electron-no-side-effects.test.ts`. Scans for `softprops/action-gh-release`, `actions/create-release`, `npm publish`, `git tag v\d`, `git push origin v\d`. Strips YAML full-line comments before scanning so documentation discussing the forbidden patterns is not falsely flagged.
- [x] 5.2 Same test also scans `_electron-build.yml` with the same patterns. Additionally asserts `ci-electron.yml` triggers only on `workflow_dispatch` (no push/pr/schedule/release). All 3 tests pass.

## 6. Documentation

- [x] 6.1 `README.md` updated: new `### On-demand Electron build (CI dispatch)` subsection under `## CI/CD & releasing` (between Releasing and Trusted Publisher setup). Covers workflow path, trigger, slug shape, artifact retention, safety guarantees.
- [x] 6.2 `docs/file-index-skills-misc.md` updated via subagent: rows added for `_electron-build.yml` and `ci-electron.yml` in path-alphabetical order, caveman style.
- [x] 6.3 `docs/faq.md` updated via subagent: Q/A entry "How do I get an installer for a feature branch without cutting a release?" inserted between the release-cut and Trusted Publisher entries.

## 7. Verification

All Phase 7 tasks require manual CI dispatches and external observation — they
cannot be completed locally. Run them after the change is pushed to a branch.

- [ ] 7.1 Dispatch `ci-electron` on `develop` with `legs: linux-x64` (cheap). Confirm: artifact appears, downloadable from Actions UI, contains an AppImage that installs in a clean `ubuntu:24.04` container via `test-electron-install.sh` and reaches `GET /api/health` 200. (The source-bundle harness in task 1 already validates boot via `Test 8`; task 7.1 validates the full Electron-packaged artifact path end-to-end.)
- [ ] 7.2 Dispatch `ci-electron` on a `feature/*` branch with `legs: all`. Confirm: branch slug appears in version, all 6 legs upload, no Release created, no npm version published.
- [ ] 7.3 Confirm an installed dev's Electron app (running the previous stable) does NOT receive an auto-update prompt after the CI dispatch completes. (Manual check — open the app, wait 90s past the initial-check timer, verify no update dialog.)
- [ ] 7.4 Re-run the release pipeline against a real tag and confirm end-to-end parity with the pre-refactor baseline.
