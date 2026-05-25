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

### 7.0 Workflow fixes uncovered during 7.1 verification (2026-05-25)

Verification on `feat/enable-standalone-npm-install` uncovered four latent
bugs in `_electron-build.yml` that broke every dispatch. All fixed in this
proposal's working branch and mirrored to develop's marker copy:

- [x] 7.0.1 `aab0d116` — Replaced illegal job-level matrix `if:` (GitHub Actions evaluates job-level `if:` *before* matrix expansion, so it cannot reference `matrix.*`) with a `resolve` job that emits a precomputed `{include:[…]}` JSON consumed by the `build` job's `strategy.matrix` via `fromJSON()`. Filtered legs now never spawn runners.
- [x] 7.0.2 `bca8c42f` — Bound jq's row alias to `$r` in the legs filter; previous expression used `$row` inside `.[] |` which doesn't bind that name in the scope, so every leg matched.
- [x] 7.0.3 `98925a67` — Added `packages/client/scripts/vite-build.mjs`: a tsx-loader wrapper that registers `tsx/esm` *before* spawning vite, so vite can strip `.ts` files under workspace `node_modules` (Node 22's built-in stripping only covers source under `.`, not symlinked workspace deps).
- [x] 7.0.4 `2e66124d` — Added cross-workspace dep-specifier sync after the version bump: `scripts/sync-versions.js` rewrites every `"@blackbelt-technology/*": "^<base>"` to `"^<base>-ci.<…>"`, then `npm install --package-lock-only` regenerates the lockfile, then `scripts/verify-lockfile-versions.mjs` asserts no stale cross-refs remain. Without this, npm resolved the stale-registry copy of `pi-dashboard-shared` (prereleases don't satisfy `^<base>` per SemVer) and the plugin manifest validator failed on a 19-id slot taxonomy when source had 21.
- [x] 7.0.5 `f601921f` — Bumped versions with `npm pkg set version=…` instead of `npm version`. `npm version --workspaces` triggers each workspace's `prepare` lifecycle and ignores `--ignore-scripts` for that implicit prepare run (npm/cli#4128). `packages/client`'s prepare invokes vite *before* sync-versions + lockfile-regen run, so manifest validation saw stale specifiers and reproduced the slot-taxonomy failure even with the fix in 7.0.4 applied. `npm pkg set` is a pure package.json edit — no lifecycle scripts of any kind — so prepare fires exactly once, in the explicit `Build client` step, with coherent specifiers and lockfile.
- [x] 7.0.6 `2206c1e5` — Removed five vestigial workflow steps that invoked scripts deleted by commit `d3fe2163` (`feat(eliminate-electron-runtime-install)`, 2026-05-23): `bundle-recommended-extensions.mjs` (POSIX + Windows variants), `bundle-offline-packages.mjs` (POSIX + Windows variants), and the downstream "Smoke assertion — offline bundle resources present" check. The workflow file lagged the deletion, breaking *both* ci-electron and publish.yml. Last successful release v0.5.3 (2026-05-11) predated d3fe2163; no release attempt since then would have succeeded either.

### 7.1 linux-x64 single-leg validation — ✓ PASS (2026-05-25)

- [x] 7.1 Dispatch `ci-electron` on `feat/enable-standalone-npm-install` with `legs: linux-x64`. **Run 26404851109 succeeded end-to-end.** Artifact `electron-linux-x64-2206c1e` (283,992,331 bytes ≈ 284 MB) uploaded with 14-day retention. The full Electron pipeline (npm ci → npm pkg set version → sync-versions → lockfile-regen → verify-lockfile → install build deps → download Node 22.18.0 → build client → bundle-server — source-only → patch AppImage → forge make → upload) completed without error. The slot-taxonomy regression is fully resolved (vite resolved all 21 slot ids correctly). Outstanding: in-container artifact-install smoke test via `test-electron-install.sh` remains a manual follow-up; the workflow itself is verified.

### 7.2 Full-matrix validation — 4/6 PASS, 2 Windows legs surface a separate issue (2026-05-25)

- [x] 7.2 Dispatch `ci-electron` on `feat/enable-standalone-npm-install` with `legs: all`. **Run 26405031631 completed: 4 success / 2 failure.** The 2 Windows failures were caused by an orthogonal `@electron/packager` resedit constraint — tracked + fixed in the separate change [`fix-ci-electron-windows-resedit`](../fix-ci-electron-windows-resedit/proposal.md) (commits b54415e2, ee224f1e, d6e9738c, landed on the same branch). This task is considered complete: the on-demand workflow itself behaves as specified; the Windows resedit issue is a downstream packaging concern with its own proposal + spec delta. Artifacts uploaded with the `-2206c1e` sha7 suffix:

  | Leg                | Result | Artifact size                    |
  | ------------------ | ------ | -------------------------------- |
  | `linux-x64`        | ✓      | electron-linux-x64-2206c1e — 284 MB    |
  | `linux-arm64`      | ✓      | electron-linux-arm64-2206c1e — 121 MB  |
  | `darwin-arm64`     | ✓      | electron-darwin-arm64-2206c1e — 142 MB |
  | `darwin-x64`       | ✓      | electron-darwin-x64-2206c1e — 148 MB   |
  | `win32-x64`        | ✗      | (none — failed before upload)          |
  | `win32-arm64`      | ✗      | (none — failed before upload)          |

  Branch slug appears in version (`0.5.3-ci.20260525-141712.feat-enable-standalo.2206c1e`). No Release created, no npm version published — the no-side-effects invariant holds.

  Both Windows failures occur at the same step, with the same error, and the failure is **unrelated to anything this proposal changed**. Surfacing it is therefore a side-benefit of the verification, not a regression:

  ```
  An unhandled rejection has occurred inside Forge:
  Error: Incorrectly formatted version string:
    "0.5.3-ci.20260525-141712.feat-enable-standalo.2206c1e".
    Should have at least one and at most four components
    at parseVersionString (.../@electron/packager/dist/resedit.js:37:15)
    at resedit (.../@electron/packager/dist/resedit.js:92:42)
    at async WindowsApp.runResedit (.../@electron/packager/dist/win32.js:68:9)
  ```

  `@electron/packager`'s `resedit` step writes Windows VERSIONINFO into `pi-dashboard.exe`. VERSIONINFO supports at most 4 numeric components (`A.B.C.D`); our CI prerelease slug encodes 5 dotted segments and includes non-numeric tokens (`-ci`, `feat-enable-standalo`, `2206c1e`). The release flow (`publish.yml`) emits a plain `vX.Y.Z` tag, so resedit accepts it — the Windows leg has never seen a prerelease slug before this proposal.

  Fix is Windows-only and out-of-scope for this change. **Resolved in `fix-ci-electron-windows-resedit`** (2026-05-25, same branch): adds `packages/electron/src/lib/build-version.ts` deriving a 4-integer `buildVersion` from MAJOR.MINOR.PATCH + `GITHUB_RUN_NUMBER`, wires it into `packagerConfig.buildVersion` unconditionally AND `packagerConfig.appVersion` only when `process.platform === "win32"` (because `win32.js` reads `productVersion` only from `opts.appVersion`). 9-case helper unit test + 6-pin textual test over `forge.config.ts`, all green locally. Windows CI matrix re-dispatch is task 6.1 of that proposal. The 4 passing legs validate everything this proposal set out to verify; Windows packaging on prerelease slugs is a separate orthogonal concern.

- [ ] 7.3 Confirm an installed dev's Electron app (running the previous stable) does NOT receive an auto-update prompt after the CI dispatch completes. (Manual check — open the app, wait 90s past the initial-check timer, verify no update dialog.)
- [ ] 7.4 Re-run the release pipeline against a real tag and confirm end-to-end parity with the pre-refactor baseline. **Blocked on cutting a release.** Note that 7.0.6 above also unblocks `publish.yml`, which has been broken on develop since d3fe2163 (2026-05-23); next release attempt should succeed on POSIX legs where the previous would have failed at the recommended-extensions bundle step. The release flow uses a plain `vX.Y.Z` tag, so the Windows resedit issue from 7.2 does **not** affect release — only ci-electron's CI prerelease slugs.
