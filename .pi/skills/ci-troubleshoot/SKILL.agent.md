# SKILL.md — ci-troubleshoot index

Pull-only condensed map. Source: .pi/skills/ci-troubleshoot/SKILL.md. Diagnose red GitHub Actions runs: workflow taxonomy, affected-test selection, release pipeline, known failures, gh log reading.

Triggers: "CI run is red", "release is stuck", "workflow won't dispatch", "which workflow does what". See `release-cut` (trigger release), `release-revoke` (revoke).

## Workflow taxonomy
- 11 workflow files: 9 entry + 2 reusable (`_smoke.yml`, `_electron-build.yml`).
- Entry: `ci.yml`, `nightly-tests.yml`, `deploy-site.yml` (GitHub Pages), `ci-e2e-electron.yml`, `ci-smoke.yml`, `publish.yml`, `ci-electron.yml`, `nightly.yml`, `sync-release-version.yml`.
- Full detail: `references/workflow-taxonomy.md`.

## First moves
- `pnpm exec tsx .pi/skills/ci-troubleshoot/scripts/list-recent-runs.ts` (last 10); `--failed` filter.
- `pnpm exec tsx .pi/skills/ci-troubleshoot/scripts/show-failed-run.ts [run-id]` (failed steps + log tails; no id = latest failed).
- Needs `gh auth status` OK. Scripts are TS, run via `pnpm exec tsx`.

## `ci.yml` jobs (affected-only tests)
- `select` → `scripts/select-affected-tests.mjs`; artifact `test-selection`. Degrades to `mode: full` on own error.
- `ci` → guards, spec validate, lint, `lint:e2e`, Biome, build, publish-import. NO tests.
- `unit` ×4 → shard `n` via `pnpm run test:parallel <files>`; `verify-executed` checks assigned files ran.
- `real-process` → real-process files; retries once under CI.
- `ci-scenarios` → `RUN_CI_SCENARIOS` packaging files; skipped for OpenSpec-only diffs.
- `ci-result` → aggregate via `check-result.mjs`.
- Inspect selection: `gh run download <id> -n test-selection -D /tmp/sel`; `jq` `selection.json`.
- Mode `full` reasons: global input (lockfile, root `package.json`, vitest/tsconfig, setupFiles, selector data); unmapped file outside `packages/`; `ci:full` label; `workflow_dispatch`; selector error.
- Force full: `ci:full` label (applies NEXT push, no `labeled` trigger) or `gh workflow run ci.yml --ref <branch>`.
- Slow tier: `scripts/test-selection/slow-tier.json` (504 s mutation harness) deselected in affected mode unless file changed; runs nightly/full/`ci:full`.
- Nightly-red, PR-green: bisect `nightly-tests` issue range; check breaking PR's `test-selection`. Selected → debug test. Not selected → `scripts/test-selection/triggers.json` or layer fix. Never just re-run.
- `nightly-tests` issue: "no report" = infra; "no new commits" = flake/env. Timings: artifact `test-timings` → `scripts/test-selection/timings.json` by hand.

## Vitest report (read FIRST on unit failure)
- Artifacts: `vitest-report-unit-<n>`, `vitest-report-real-process`, `vitest-report-ci-scenarios` (`if: always()`, 14-day retention).
- `gh run download <id> -p 'vitest-report-*' -D /tmp/vr`
- Failures: `jq` `.testResults[].assertionResults[] | select(.status=="failed")`.
- Retried passes: `status=="passed"` AND non-empty `failureMessages`. No `retryCount` field (vitest 4.1.11 JSON). Re-verify after vitest major upgrade.
- Retry: only `server-real-process` project, only `CI`, once (`retry: process.env.CI ? 1 : 0`). Local retry 0.
- Local `npm test` = `test:parallel` then `test:real-process`.

## Triage tree
- `ci.yml` → tests/lint/build → `references/common-failures.md`.
- `publish.yml` → release job: `tag-and-push` | npm ordering | electron matrix | github-release asset collision.
- `ci-electron.yml` → on-demand Electron smoke, never publish.

## Release pipeline — `publish.yml`
- Graph: `resolve` → `ci-checks` + `smoke` (`_smoke.yml`) → `tag-and-push` → `publish` → `electron` (`_electron-build.yml`) → `github-release`.
- Tag-push skips `tag-and-push`; `publish.if` accepts skip.
- Do NOT remove `needs: [resolve, publish]` from `electron`. Locked by `packages/shared/src/__tests__/publish-workflow-contract.test.ts`.
- Walkthrough: `references/release-pipeline.md`.

## Known failures (headline; full in `references/common-failures.md`)
- `verify-lockfile-versions.mjs` (`tag-and-push`): regen lockfile or fix `scripts/sync-versions.js`.
- CHANGELOG has `## [X.Y.Z]`: bump version or revert section.
- `npm publish` 403 (`publish`): configure OIDC trusted publisher; or NPM_TOKEN.
- Electron leg fail: missing node-pty/better-sqlite3 prebuild; check `bundle-server.mjs` GO/NO-GO guard.
- `shell: bash` on Windows: `no-bash-on-windows.test.ts`; remove or `if: runner.os != 'Windows'`.
- Electron missing `needs:`: `publish-workflow-contract.test.ts`.
- `Cannot find module @blackbelt-technology/...` in electron: `publish` didn't run; never bypass.
- Fastify crash in bundled smoke: `node-version:` ≥ 22.18.0.
- Timing flake in `real-process`: `vitest-report-real-process` `passed` + `failureMessages`; root-cause.
- `verify-executed` fail: vitest filter/path mismatch; re-run `node scripts/select-affected-tests.mjs --base origin/develop --merge-base --out /tmp/s.json`.
- `ci-result` red, all green: EXPECTED job skipped or `select` failed.
- `real-process-project-guard.test.ts`: add file to `packages/server/vitest.real-process-files.ts` or `// real-process-exempt: <reason>`.
- `electron` + `github-release` SKIPPED after green `publish`: give `electron` `if: ${{ !cancelled() && needs.publish.result == 'success' }}`. First hit v0.6.1.
- koffi GO/NO-GO fail win32: koffi 3.x path `@koromix/koffi-win32-x64/win32_x64/koffi.node` first, 2.x fallback. v0.6.1.
- arm64 NSIS smoke `pi-dashboard.exe not found`: guard `if: matrix.platform == 'win32' && matrix.arch == 'x64'`. v0.6.1.

## gh log commands
- `gh run list -L 10`; `gh run view <id> --log-failed` (highest leverage); `gh run watch <id>`.
- `gh run rerun <id> --failed` (keeps green jobs); `gh run rerun <id>` (full); `gh run cancel <id>`.
- Rerun gotcha: `--failed` does NOT re-dispatch skipped reusable downstream (`electron`). Fix: `git push --delete origin vX.Y.Z && git push origin vX.Y.Z`. `publish` idempotent.
- Never manual `npm publish` (loses OIDC, lockfile sync, changelog promotion, smoke gates, Electron ordering).

## CodeQL cache-poisoning / missing-workflow-permissions
- Pinned by `packages/shared/src/__tests__/workflow-token-cache-contract.test.ts`. Change: harden-ci-cache-poisoning.
- Release-privileged job (write perms, id-token write, non-GITHUB_TOKEN secret, environment, or in `SHIPS_IN_RELEASE`): no cache restore.
- `missing-workflow-permissions`: add top-level `permissions: contents: read`.
- Expected residual `poisonable-step` alerts: `_smoke.yml` ×4, `publish.yml` `ci-checks` ×4, `_electron-build.yml` ×10. Dismiss only after post-merge scan matches this set; else re-read design.md D4/D5.
- Dismiss: `gh api -X PATCH repos/{owner}/{repo}/code-scanning/alerts/<n>` with `state=dismissed`, `dismissed_reason=won't fix`. Test on one first. Record numbers in PR. Revert → re-open.

## Repo-lint
- Fails `ci` job. Listed in `debug-dashboard/references/test-failure-triage.md` → "Repo-lint tests". Fix the file; never loosen lint.

