## 1. Extract reusable `_smoke.yml`

- [x] 1.1 Create `.github/workflows/_smoke.yml` with `on: workflow_call`, input `ref` (string, required)
- [x] 1.2 Move the `standalone-install-smoke-linux` matrix job from `ci.yml` into `_smoke.yml`, parameterizing the checkout step to use `ref: ${{ inputs.ref }}`
- [x] 1.3 Move the `standalone-install-smoke-windows` job from `ci.yml` into `_smoke.yml` using the same `ref:` parameter
- [x] 1.4 Add a header comment to `_smoke.yml` mirroring the `_electron-build.yml` style: list consumers, declare "MUST NOT publish or release", cite change `gate-publish-on-smoke-and-tests`
- [x] 1.5 Verify the file parses (`yamllint` or `node -e "require('js-yaml').load(...)"`); no behavior change yet because nothing calls it

## 2. Add manual dispatch workflow `ci-smoke.yml`

- [x] 2.1 Create `.github/workflows/ci-smoke.yml` with `on: workflow_dispatch` (no inputs)
- [x] 2.2 Add `concurrency: { group: ci-smoke-${{ github.ref }}, cancel-in-progress: true }`
- [x] 2.3 Define a single job that does `uses: ./.github/workflows/_smoke.yml` with `ref: ${{ github.ref }}`
- [x] 2.4 Manual verification: dispatch `ci-smoke.yml` from the Actions UI against `develop`, observe all 7 legs run green
- [x] 2.5 Manual verification: dispatch twice in quick succession on the same branch, observe the first run is cancelled

## 3. Refactor `publish.yml` — split `prepare`

- [x] 3.1 Rename today's `prepare` job to `resolve`; strip out the bump/sync/commit/tag/push steps, keep only version resolution. Add `outputs.ref` (the sha the gate will test: `${{ github.sha }}` on tag-push, `${{ github.event.workflow_run.head_sha }}` or equivalent on dispatch)
- [x] 3.2 Create a new `tag-and-push` job with `needs: [resolve, ci-checks, smoke]` and `if: github.event_name == 'workflow_dispatch'`; move the bump/sync/CHANGELOG/lockfile-regen/commit/tag/push steps here
- [x] 3.3 Ensure `tag-and-push` preserves the existing lockfile-regen step ordering required by spec requirement `Release lockfile MUST mirror workspace versions` (sync-versions < `npm install --package-lock-only` < `verify-lockfile-versions.mjs` < commit)
- [x] 3.4 Update `publish` job's `needs:` to `[resolve, ci-checks, smoke, tag-and-push]` and update any `${{ needs.prepare.outputs.* }}` references to `${{ needs.resolve.outputs.* }}` (or `tag-and-push.outputs.*` where appropriate, e.g. final tag sha)
- [x] 3.5 Update `electron` job's `needs:` to keep `[resolve, publish]` (or equivalent — the contract that electron runs AFTER publish must be preserved per spec)
- [x] 3.6 Update `github-release` job's `needs:` similarly

## 4. Refactor `publish.yml` — add `release-gate` sub-jobs

- [x] 4.1 Add `ci-checks` job to `publish.yml`: `needs: [resolve]`, `runs-on: ubuntu-latest`, Node 22, checkout `${{ needs.resolve.outputs.ref }}`, run `npm ci && npm run lint && npm test && npm run build`
- [x] 4.2 Add `smoke` job to `publish.yml`: `needs: [resolve]`, `uses: ./.github/workflows/_smoke.yml`, `with: { ref: ${{ needs.resolve.outputs.ref }} }`
- [x] 4.3 Verify both `ci-checks` and `smoke` are NOT gated by `tag-and-push` — they must run in parallel right after `resolve`
- [x] 4.4 Manual verification (dispatch path): trigger `publish.yml` via `workflow_dispatch` with a `-rc.test` version against a throwaway branch; observe `resolve → [ci-checks, smoke] → tag-and-push → publish → electron → github-release`
- [x] 4.5 Manual verification (failure mode): intentionally break a unit test on a branch, dispatch publish, observe `ci-checks` fails, `tag-and-push` and `publish` are skipped, no tag is created

## 5. Remove smoke jobs from `ci.yml`

- [x] 5.1 Delete the `standalone-install-smoke-linux` job from `ci.yml`
- [x] 5.2 Delete the `standalone-install-smoke-windows` job from `ci.yml`
- [x] 5.3 Confirm `ci.yml` retains the cheap `ci` job (lint + test + build, Node 22) on `push` and `pull_request` to `develop`
- [x] 5.4 Open a no-op PR; observe only the `ci` job runs (no smoke); merge or close

## 6. Repo-lint extension

- [x] 6.1 Extend `packages/shared/src/__tests__/publish-workflow-contract.test.ts` with the five contract assertions from spec requirement "Repo-lint pins the release-gate contract" (resolve.outputs.ref, ci-checks shape, smoke `uses:` + ref param, tag-and-push `if:` guard, publish.needs membership)
- [x] 6.2 Each assertion's failure message SHALL name the offending job/field and cite change `gate-publish-on-smoke-and-tests`
- [x] 6.3 Run `npm test 2>&1 | tee /tmp/pi-test.log` and grep for the new test names; verify they pass against the refactored `publish.yml`
- [x] 6.4 Verify failure mode: locally edit `publish.yml` to remove the `smoke` job's `needs:` from `publish.needs`, re-run the test, confirm it fails with the cited message; revert

## 7. Spec & docs sync

- [x] 7.1 Run `openspec validate gate-publish-on-smoke-and-tests` — must be clean (already is)
- [x] 7.2 Update `.pi/skills/release-cut/SKILL.md`: add a "Before tagging" step recommending operators dispatch `ci-smoke.yml` against `develop` first (catches regressions before tag exists)
- [x] 7.3 Add an entry to `docs/faq.md`: "Why didn't my PR run the install smoke matrix?" → explain the trigger change, point at `ci-smoke.yml` and the release-gate
- [x] 7.4 Update `AGENTS.md` "Key Files" table with rows for `_smoke.yml` and `ci-smoke.yml` (≤ 200 chars each; per-file detail goes to `docs/file-index-*.md` if a CI split exists, else inline)
- [x] 7.5 Cross-check: `openspec/specs/ci-cd-pipeline/spec.md` after archive will reflect both the smoke matrix re-homing AND the release-gate; no orphan scenarios from the old `prepare` shape

## 8. Verify end-to-end

- [x] 8.1 Cut a real prerelease tag (e.g. `v0.X.Y-rc.0`) via `workflow_dispatch`; observe the full pipeline runs in order, gate succeeds, npm publish goes to `next` dist-tag, electron artifacts produced, draft GitHub Release created with `prerelease: true`
- [x] 8.2 Verify release wall-clock time is within ~10 min of pre-change baseline + one smoke-matrix runtime (~25 min → ~35 min target)
- [x] 8.3 Update CHANGELOG.md `[Unreleased]` with a one-line entry describing the gate addition
- [x] 8.4 Run `npm run reload:check` to confirm no type errors slipped in via the lint test edits
