## Why

`ci.yml` takes 44–50 min per run (15 runs sampled, 2026-09-29/30). One serial job does all the work: `pnpm test` takes 28–33 min, `test:ci-scenarios` takes 11–12 min, and every other step together takes about 6 min. Every PR and every push to `develop` pays that cost, whatever the diff touches. `test:ci-scenarios` also re-runs the whole `scripts` project, including the 504 s mutation harness, although only 7 of its files are gated on `RUN_CI_SCENARIOS`, so part of that time is duplicate work.

A spike (explore session, 2026-09-30) measured the alternative on 11 real `develop` commits and 8 red CI runs:

- Vitest's own import graph, walked with per-module error tolerance, maps every test file to its local source dependencies in about **5 s** for the whole repo (~2,100 test files). Cross-package edges resolve, because workspace `exports` point at `src/`.
- An affected-only selection drops a typical PR from **32.3 file-minutes to 2.6–12 file-minutes**. The selection is: tests whose graph touches the diff, plus the 174 tests with no local deps (≈3 file-min), plus a package-level fallback for files no test imports.
- None of the red runs was a diff-caused regression that selection would have missed. `mdi-chunk-size` (a whole-bundle budget test) has no import edges, so it lands in the always-run set. `ProviderAddDialog` is a contention flake with no dependency on the diff, so selection correctly skips it.
- Stock `vitest --changed` is **not** usable as-is. One unresolvable import (`monaco-editor` has no `main`) aborts the walk for 31 test files. Its default `**/package.json` trigger forces a full run for any package manifest edit. It also never sees the real-process config, which is kept outside root `projects`.
- Side finding: five test-bearing packages (`apple-tools`, `dashboard-plugin-skill`, `hermes-memory-plugin`, `pi-forms-bpmn`, `quota-plugin`; 36 test files in total) are missing from the root `vitest.config.ts` `projects`, so no CI job has ever run their tests.

## What Changes

- **Affected-test selector.** A new repo script uses vitest's resolved projects (root config **and** real-process config) and its SSR transform graph to compute, for a git base ref, which test files run and why. A module that fails to transform becomes a leaf; it does not drop the whole test file. The diff has no rename detection, so both paths of a rename count, and deletions count. Layers, in order:
  1. **Global triggers** (lockfile, root manifest, vitest/tsconfig configs, vitest setup and globalSetup files, the selector and its data files) → full run.
  2. **Graph hits.** A test file runs when it, or any local module it reaches, changed. A module with a non-literal dynamic `import()` is an open edge, so any change in its package selects the tests that import it.
  3. **Always-run set.** Test files with zero local deps run on **every** diff, docs-only included. These are the file-reading contract and budget tests. There is no "run nothing" mode.
  4. **Path-literal readers.** A test whose source names a changed location in a string literal (`openspec/…`, `.github/…`, `packages/server/…`) is selected. This catches cross-package and outside-package reads by path.
  5. **Package fallback.** Nothing under `packages/` is ignorable. A changed file there that no test graph reaches (css, json, Markdown read by tests, fixtures, jiti-loaded code, type-only modules) selects that package's tests plus every test whose graph enters the package. `packages/<p>/package.json` is scoped the same way.
  6. **Outside `packages/`.** A checked-in trigger map selects tests for files read through dynamically built paths. A checked-in covered-elsewhere list names paths whose readers are all always-run or path-literal readers. Anything else → full run.
  7. **Slow tier.** This is a deliberate, logged exception to every other layer, and it is applied last. A manifest, seeded only with the 504 s mutation harness, lists files that run only in full mode or when the file itself is edited.

  Any selector error, all-zero base, or force-pushed base → full run.
- **`ci.yml` split into parallel jobs** on PRs and on pushes to `develop`:
  - `ci`: keeps its name and holds every guard, `lint`, `lint:e2e`, Biome, build, and both publish-import checks.
  - `select`
  - `unit`: 4 shards. **The selector assigns the files**, and each shard asserts every assigned file executed, so no vacuous green. Chromium is installed.
  - `real-process`
  - `ci-scenarios`: only the `RUN_CI_SCENARIOS`-gated files (never placed in a unit shard), on every diff that is not OpenSpec-only. Root docs ship in the package, so docs diffs count.
  - `docker-plugin-load` and `music-pytest` (unchanged)
  - `ci-result`, an aggregate.

  PRs and `develop` pushes both use affected-only selection (user decision). The PR label `ci:full` makes the next push to that PR run the full suite, and a `workflow_dispatch` run is always full. There is no `labeled` trigger, so adding a label can never produce a fake-green run.
- **Nightly full suite, enabled from day one.** A new `nightly-tests.yml` runs on an active cron plus `workflow_dispatch`. It runs the full sharded suite including the slow tier, the real-process phase, and `test:ci-scenarios`. On a red scheduled run it opens or updates one `nightly-tests` issue naming the failing files, any job with no report, and the `develop` range since the last green **scheduled** run. It is separate from the land-dark `nightly.yml`.
- **Selection is auditable.** The job summary and a `test-selection` artifact record the mode, reason, per-layer counts, shard assignment, unmapped files, leaf errors and slow-tier deselections.
- **Collection completeness guard.** The five uncollected packages are added to root `projects`, or explicitly excluded with a reason. A repo-lint test fails on any test-bearing package that is neither collected nor explicitly excluded.
- The vitest JSON report upload moves to every vitest job, with per-job and per-shard names.

**BREAKING (process):** a regression missed by selection on a PR or `develop` push surfaces in the next scheduled nightly, not on the merge that caused it. The same applies to the slow tier. This is accepted by user decision; the nightly issue names the range to bisect.

## Capabilities

### New Capabilities
- `affected-test-selection`: how CI decides which vitest files run for a diff. Covers the layers, fail-safe fallbacks, slow tier, escape hatches, shard self-verification, audit output, and collection completeness.

### Modified Capabilities
- `ci-cd-pipeline`:
  - "CI workflow on push and PR": parallel jobs, affected-only unit tests, no `labeled` trigger, PR-scoped concurrency, an aggregate result that checks the selection's expectations, and the guards job keeping the name `ci`.
  - "CI uploads the vitest JSON report on every run": per job and shard, and a missing report is never counted as passing.
  - "Release-gate runs lint+test+build and smoke before publish": `ci-checks` is the full suite and no longer claims to match `ci.yml`'s `ci` job.
- `nightly-verification`: adds the scheduled full-suite nightly and its anchored failure issue.
- `parallel-test-execution`: "Real-process tests run in a dedicated low-concurrency phase". In CI the phase may run on its own runner. The invariant becomes "never concurrently with the parallel projects on one machine". Local `npm test` sequencing is unchanged.

## Impact

- `.github/workflows/ci.yml` is restructured. `.github/workflows/nightly-tests.yml` is new.
- New `scripts/select-affected-tests.mjs` and `scripts/test-selection/` (trigger map, covered-elsewhere list, slow tier, timings).
- Root `vitest.config.ts` gains up to five packages, so **local `npm test` also runs up to 36 more files**. That is the one intentional change to local behaviour; they may be red on first collection.
- Contract tests pinning `ci.yml` get updated: `ci-vitest-report-artifact`, `ci-publish-imports-workflow-contract`, `pnpm-migration-contract`, `ci-music-pytest`, `no-bash-on-windows`, `no-hardcoded-node-modules-paths`, plus the publish-workflow release-gate contract if it pins the parenthetical. New contract tests cover `nightly-tests.yml`, the selector, the literal-path scan, and collection completeness.
- `.github/workflows/AGENTS.md`, `scripts/AGENTS.md`, and the `ci-troubleshoot` skill are updated.
- **Overlap:** active change `fix-ci-pipeline-followups` MODIFIES the same two `ci-cd-pipeline` requirements ("CI workflow on push and PR", "Release-gate…"). These deltas start from its pnpm wording. Whichever change archives second must rebase its deltas. Its task 3.2 would also pin lint→test→build order in `ci.yml` (`pnpm-migration-contract` X5), which this change deliberately breaks. Design D8 defines how that is resolved in either landing order. Active change `test-trust-audit` also edits root `vitest.config.ts` `projects`.
- No runtime, protocol, or published-package change.
- Rollback: the `ci.yml` switch and its contract-test rewrites land as one commit, so reverting that commit restores both. The selector and nightly are additive.

## Discipline Skills

- `doubt-driven-review`: before the selection layers stand. A false negative is the failure mode that matters, and it is invisible in a green run. One cycle has already run on these artifacts, single-model plus cross-model.
- `performance-optimization`: measure-first. Record the baseline (44–50 min wall, 32.3 file-min) and the post-change PR, `develop`-push and nightly wall times from real runs, not estimates.
- `observability-instrumentation`: the selector's job summary and artifact are the only evidence of what was skipped. Nightly-issue attribution depends on them.
- `review-code`: before commit.
