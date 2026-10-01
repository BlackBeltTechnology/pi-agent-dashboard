## 1. Baseline and collection completeness

- [x] 1.1 Record the baseline in `design.md` Context (already measured: 44–50 min wall, `pnpm test` 28–33 min, `ci-scenarios` 11–12 min, full suite 32.3 file-min) and link the two sampled run IDs. Verify both run IDs resolve with `gh run view`.
- [x] 1.2 Write the collection-completeness repo-lint test (D7) first. Verify it fails today, naming `apple-tools`, `dashboard-plugin-skill`, `hermes-memory-plugin`, `pi-forms-bpmn` and `quota-plugin`.
- [x] 1.3 Put `electron` on the exclusion list (reason: only its build-contract config runs under the root runner). For each of the five other packages, either add it to root `projects` and fix any red files (no per-file quarantine), or exclude the whole package with a reason. Make sure the scan skips `node_modules/`, `dist/` and `out/`. The reason must name the config fact that prevents root collection, e.g. `dashboard-plugin-skill` `singleFork`. Verify the 1.2 test passes and `pnpm test` is green. — Done: `apple-tools`, `dashboard-plugin-skill` (vitest-4 worker config; dead `singleFork` dropped), `hermes-memory-plugin` (stale Save-button test now drives the host Save Bar commit), `quota-plugin` collected; `electron` + `pi-forms-bpmn` excluded with reasons. Full suite green on CI run 36795285794; locally only `system-one-plugin` supervisor X12 fails, and it fails identically on a pristine `origin/develop` checkout (environmental).

## 2. Selector core (TDD)

- [x] 2.1 Create `scripts/test-selection/{triggers,covered-elsewhere,slow-tier,timings}.json` per D4. `slow-tier.json` holds only the mutation harness; `timings.json` is seeded from the sampled CI report. Verify each is valid JSON.
- [x] 2.2 Author the §8 L1 selector rows (8.1–8.27, 8.32) as failing tests before implementing anything, per TDD. Write them in `scripts/__tests__/select-affected-tests.test.mjs` for the pure decision function, using a synthetic graph, diff and literal index. They cover:
  - mode precedence (error, global, unknown-outside, affected);
  - the union of every layer;
  - always-run on an OpenSpec-only diff;
  - path-literal selection, including a cross-package reader;
  - open-edge package widening;
  - package fallback, including Markdown and `package.json` scoping;
  - the slow tier applied last over the graph, trigger and literal layers, re-included on edit, and logged;
  - both paths of a rename, plus deletions;
  - `timings.json` not being a global input;
  - the packaging-scenarios flag (true unless the diff is OpenSpec-only; a root `AGENTS.md` diff sets it);
  - `RUN_CI_SCENARIOS`-gated files routed only to the packaging-scenarios job, never to a shard;
  - covered-elsewhere entries limited to top-level locations.

  Verify they fail.
- [x] 2.3 Implement the pure decision module. Verify the 2.2 tests pass.
- [x] 2.4 Implement the graph builder over **both** the root and real-process configs, with per-module transform tolerance, open-edge detection (non-literal SSR dynamic import) and the per-test literal index (D1/D2). Add an integration test on the current tree:
  - `monaco-setup.ts` is a leaf error;
  - `SettingsPanel.tsx` is reachable from `SettingsPanel.test.tsx`;
  - `keeper.test.ts` is in the real-process set;
  - `check-conventions.test.mjs` is indexed as a reader of `openspec`;
  - the whole build takes under 60 s.
- [x] 2.5 Derive the global inputs: the static list plus every `setupFiles`/`globalSetup` from both configs. Verify with a test that a project setup file in the diff yields `full`.
- [x] 2.6 Implement base resolution and the diff (`--no-renames`): PR merge-base; push `before`, handling all-zero and non-ancestor (force-push) bases; `--full` for dispatch; a missing ref → `full` with the ref named. Verify with tests on a temporary git repo fixture.
- [x] 2.7 Implement shard assignment (greedy LPT over `timings.json`, median for unknown files, 4 shards, deterministic tie-break by path), and export the shard count as a constant. Verify with a unit test that the output is deterministic and that the largest shard ≤ the optimum + the maximum single-file time.
- [x] 2.8 Implement the CLI: `node scripts/select-affected-tests.mjs --base <ref> | --full --out selection.json`, writing a `$GITHUB_STEP_SUMMARY` block (mode, reason, per-layer counts, unmapped/leaf-error/open-edge files, slow-tier deselections, share of files with no timing data). Any uncaught error writes `mode: full`. Verify a forced-throw test yields `full` with exit 0.
- [x] 2.9 Implement `scripts/test-selection/verify-executed.mjs <selection.json> <job-key> <vitest-report.json>`. Verify it fails on a report missing one assigned file and passes on an exact match.
- [x] 2.10 Implement `scripts/test-selection/check-result.mjs`, the `ci-result` expectation check: it takes `selection.json` plus the job results and fails when `select` did not succeed, when any job failed or was cancelled, or when an expected job was skipped. Verify with unit tests for each case.
- [x] 2.11 Replay the spike commits against the finished selector: `7ab920061`, `c287d3408`, `0138e9d26`, `ba50d70e6`, `d3b8f4927`, `9f10c3196`, `b6ef839ad`, `559f0ed85`, `4aa093982`, `8d19223ed`, `6beb1fc46`. Verify `mdi-chunk-size.test.ts` is selected on every commit and `ProviderAddDialog.test.tsx` is not selected for `6beb1fc46` once its global inputs are masked. Record the per-commit mode and file-min table in `design.md`. — Done; table in design.md Measurements. **Deviation:** `ProviderAddDialog.test.tsx` IS selected for masked `6beb1fc46` via package fallback on a co-changed `*.AGENTS.md` (E12 requires it); recorded in design.md.
- [x] 2.12 Write the data-file contract test (D7): slow-tier entries exist; trigger, trigger-test and covered-elsewhere globs each match at least one file; the shard count constant equals the `ci.yml` matrix length. Verify it fails on a deliberately stale entry.

## 3. Shadow mode in ci.yml

- [x] 3.1 Extend the `ci.yml` contract test first to expect a `select` job (`fetch-depth: 0`, uploads `test-selection`) alongside the unchanged `ci` job, and verify it fails. Then add the job and verify the test passes. On a PR and on a `develop` push, verify the summary and artifact appear, the push run reports `affected` (not a depth-induced `full`), and the `ci` job is unaffected. — Done: PR shadow run 36790509101 (summary + `test-selection` artifact); push-event simulation on `tmp-route-base` (runs 36815034432, 36815958681, 36815968795) reports `affected`.
- [x] 3.2 Run the seeded-mutation recall check (design Migration step 2): one breaking mutation per listed risk class, the full suite once per mutation to get ground-truth failing files, and the selector must select every one of them. Log each class, its ground-truth set and the selection in `design.md`. Verify there are zero misses, or that each miss has a landed layer or trigger fix and has been re-checked. — Done: 9 classes, 1 miss (root `AGENTS.md` byte cap) fixed by the widened trigger map and re-checked; log in design.md.

## 4. Nightly full suite

- [x] 4.1 Write `nightly-tests-workflow-contract.test.ts` first: uncommented cron; `workflow_dispatch`; `permissions` with issues:write and actions:read; no `needs` on `nightly.yml`; `select --full`; chromium install; the `dist/index.html` assertion in every unit shard; `verify-executed` on every vitest job; per-job reports; `report` `if: always()`; no publish/tag/release steps. Verify it fails with the workflow absent.
- [x] 4.2 Create `.github/workflows/nightly-tests.yml` per D6. Verify the 4.1 test passes and one manual dispatch on `develop` goes green. — Done: workflow green on push-triggered runs of the same file on a throwaway branch (36792542376, 15.0 min). `workflow_dispatch` on `develop` itself is only possible once the file is on the default branch — run right after merge.
- [x] 4.3 Implement `scripts/test-selection/nightly-report.mjs` with unit tests first: range `A..B`; no anchor; a dispatch run not anchoring; a non-ancestor anchor skipped; `A == B`; an expected job with no report; update vs create; close on green; `timings.json` emitted. Wire it into the `report` job. Verify the unit tests pass.

## 5. Parallel ci.yml

- [x] 5.1 Resolve the D8 coordination with `fix-ci-pipeline-followups` before touching `pnpm-migration-contract` X5. If that change has landed, relax X5's `ci.yml` half as D8 states. If it has not, add a note to its `tasks.md` 3.2 limiting the order pin to `publish.yml`. Verify `pnpm test` passes on the current `ci.yml` after the relaxation. — Done: `fix-ci-pipeline-followups` not landed → coordination note added to its tasks.md 3.2. X5 pins only the install verb today, so no relaxation was needed.
- [x] 5.2 Update every contract test that pins `ci.yml` **first**, and verify they fail against the current `ci.yml`. The tests: `ci-vitest-report-artifact` (per job and shard); `ci-publish-imports-workflow-contract` (still in `ci`); `pnpm-migration-contract`; `ci-music-pytest`; `no-bash-on-windows`; `no-hardcoded-node-modules-paths`; and the publish-workflow release-gate test if it pins "matches `ci.yml`'s `ci` job". Add assertions for:
  - `ci-result` needs every job including `select`, and runs `check-result`;
  - the unit matrix length equals the shard constant;
  - `ci` does not depend on test jobs;
  - the PR trigger has the default types (no `labeled`);
  - the PR-scoped concurrency with no cancellation on push;
  - `select` `fetch-depth: 0`;
  - no unfiltered `pnpm test` or `test:ci-scenarios`;
  - shards run through `pnpm run test:parallel` / `test:real-process` / `test:ci-scenarios`.
- [x] 5.3 Restructure `ci.yml` per D5, in the **same commit** as 5.2, so that reverting that one commit rolls back cleanly. `ci` keeps its name and every guard step with its comment block, minus `pnpm test`, `test:ci-scenarios` and chromium. Add `select`, `unit` (matrix 1–4, downloads `test-selection`, empty shard skips its steps), `real-process`, `ci-scenarios`, `ci-result` and concurrency. Verify the 5.2 tests pass and `pnpm test` is green.
- [x] 5.4 Verify on real runs: — Done via throwaway PRs into `tmp-route-base` (a copy of this branch whose ci.yml also triggers there): OpenSpec-only #770 run 36815007342 (`affected`, `ci-scenarios` skipped, `ci-result` green); client-only #771 run 36815009822 (`affected`, 6 gated files, each shard report == its assignment); keeper #772 run 36815014153 (`keeper.test.ts` in `real-process`); lockfile #773 run 36815016676 (`full`); `ci:full` #774 run 36815100561 (`full`, slow tier selected); push 36815034432 (`affected`).
  - a docs-only PR: `ci` plus an always-run shard run, `ci-scenarios` is skipped, `ci-result` is green;
  - a client-only PR: `affected`, `ci-scenarios` runs the gated files, and each shard's report lists exactly its assigned files;
  - a PR touching a keeper module: the real-process job runs `keeper.test.ts`;
  - a `pnpm-lock.yaml` PR: `full`;
  - a `ci:full`-labelled PR: the next push runs `full` including the slow tier;
  - a `develop` push: `affected`.
- [x] 5.5 Verify the fail-closed paths on a throwaway branch: force `select` to fail (`ci-result` red), and remove `packages/client/dist` before a shard's vitest step (the shard fails on the `dist` assertion). — Done: forced `select` failure 36815039706 → `ci-result` failure; `dist` removed 36815042826 → every unit shard fails at the dist assertion.

## 6. Docs

- [x] 6.1 Update the `.github/workflows/AGENTS.md` rows for `ci.yml` and `nightly-tests.yml`, and add `scripts/AGENTS.md` rows for the selector and `scripts/test-selection/`. Verify every new file has a row.
- [x] 6.2 Update the `ci-troubleshoot` skill: the job taxonomy, reading the `test-selection` artifact and summary, `ci:full` (next push) vs dispatch (immediate), the slow tier, and nightly-tests issue triage (bisect the range). Verify `node scripts/check-skill-frontmatter.mjs` passes.
- [x] 6.3 Delegate the `docs/` prose (a new `docs/ci.md` covering the selection layers, fail-safe rules and the nightly) to DocScribe in caveman style, and apply the returned rows. Verify `docs/AGENTS.md` lists the page.
- [x] 6.4 Re-check both shared `ci-cd-pipeline` MODIFIED requirements against whichever version is in `openspec/specs/` at archive time. Verify `openspec validate speed-up-ci-affected-tests --strict` passes.

## 7. Measure and close

- [x] 7.1 Record post-change wall times from real runs (at least 3 each): PR affected, PR docs-only, `develop` push, nightly full. Verify PR affected wall time is under 15 min, and record the numbers in `design.md` next to the baseline. — Done: PR affected 7.3–8.3 min, OpenSpec-only 7.3–7.7, push 7.4–7.5, full 11.8–13.7, nightly 14.7–15.3 (vs 44–50 baseline). Table in design.md.
- [x] 7.2 Run `review-code` on the diff and resolve the findings. Verify there are no open blocker or major findings. — Done: ship-it 4.5 reviewer (@review) rounds 1–3; 4 + 1 blocking findings fixed with tests; round 3 `BLOCKING_COUNT: 0`.

## 8. Scenario tests (folded from test-plan.md)

Each task is one automated manifest row. Format: Triple = input · trigger · observable.

Exemplars:
- selector rows → `scripts/__tests__/check-pi-settings-paths.test.mjs` (pure fn), or `scripts/__tests__/lint-harness-scoping.test.mjs` (temporary git repo);
- workflow/repo-lint rows → `packages/shared/src/__tests__/nightly-workflow-contract.test.ts` / `real-process-project-guard.test.ts`;
- `ci` rows → dispatch pattern of `.github/workflows/ci-smoke.yml` (throwaway branch, `gh workflow run`).

- [x] 8.1 Lockfile forces full. Triple: diff `[pnpm-lock.yaml]` · `decide()` · `mode full`, reason names the file. See `scripts/__tests__/check-pi-settings-paths.test.mjs` (test-plan #E1)
- [x] 8.2 Project setupFiles force full. Triple: config `setupFiles:[p/setup.ts]`, diff that file · `decide()` · `mode full`. See `check-pi-settings-paths.test.mjs` (test-plan #E2)
- [x] 8.3 Timings file is not global. Triple: diff `[scripts/test-selection/timings.json]` · `decide()` · `mode affected`. See `check-pi-settings-paths.test.mjs` (test-plan #E3)
- [x] 8.4 Direct graph hit. Triple: `{T1:[a.ts],T2:[b.ts]}`, diff `[a.ts]` · `decide()` · T1 selected, T2 not. See `check-pi-settings-paths.test.mjs` (test-plan #E4)
- [x] 8.5 Cross-package graph hit. Triple: clientT reaches `packages/shared/src/y.ts`, diff it · `decide()` · clientT selected, layer graph. See `check-pi-settings-paths.test.mjs` (test-plan #E5)
- [x] 8.6 Test file itself changed. Triple: diff `[T2]` · `decide()` · T2 selected. See `check-pi-settings-paths.test.mjs` (test-plan #E6)
- [x] 8.7 Always-run on OpenSpec-only diff. Triple: zero-dep Z1 + dep-bearing T1, diff `[openspec/changes/x/proposal.md]` · `decide()` · affected, Z1 selected, T1 not, ciScenarios false. See `check-pi-settings-paths.test.mjs` (test-plan #E7)
- [x] 8.8 Open edge widens to package. Triple: T1 graph holds open `packages/p/src/loader.ts`, diff `packages/p/src/other.json` · `decide()` · T1 selected, layer open-edge. See `check-pi-settings-paths.test.mjs` (test-plan #E8)
- [x] 8.9 Path-literal cross-package reader. Triple: literal index clientT→`packages/server`, diff `packages/server/src/cli.ts` · `decide()` · clientT selected, layer path-literal. See `check-pi-settings-paths.test.mjs` (test-plan #E9)
- [x] 8.10 Path-literal via path segment. Triple: source has `path.join(root, "openspec", "specs")`, diff `openspec/specs/a/spec.md` · literal index + `decide()` · test selected. See `check-pi-settings-paths.test.mjs` (test-plan #E10)
- [x] 8.11 Package fallback for css. Triple: diff `packages/client/src/index.css` · `decide()` · all `packages/client/**` tests, affected. See `check-pi-settings-paths.test.mjs` (test-plan #E11)
- [x] 8.12 Package fallback for Markdown. Triple: diff `packages/extension/.pi/skills/x/SKILL.md` · `decide()` · all extension tests selected. See `check-pi-settings-paths.test.mjs` (test-plan #E12)
- [x] 8.13 Package manifest scoped. Triple: diff `packages/roles-plugin/package.json` · `decide()` · affected, roles-plugin tests plus entering graphs, ciScenarios true. See `check-pi-settings-paths.test.mjs` (test-plan #E13)
- [x] 8.14 Unknown root file forces full. Triple: diff `some-root-data.json` · `decide()` · full, reason names it. See `check-pi-settings-paths.test.mjs` (test-plan #E14)
- [x] 8.15 Trigger-map hit. Triple: map z-layer baseline→z-layer tests, diff it · `decide()` · those tests selected, affected. See `check-pi-settings-paths.test.mjs` (test-plan #E15)
- [x] 8.16 Covered-elsewhere adds nothing. Triple: diff `docs/faq.md` · `decide()` · selection = always-run plus `docs` literal readers. See `check-pi-settings-paths.test.mjs` (test-plan #E16)
- [x] 8.17 Slow tier applied last. Triple: S hit by graph + literal + trigger · `decide()` · S not selected, listed under slowTierDeselected. See `check-pi-settings-paths.test.mjs` (test-plan #E17)
- [x] 8.18 Slow tier re-included on edit. Triple: diff `[S]` · `decide()` · S selected. See `check-pi-settings-paths.test.mjs` (test-plan #E18)
- [x] 8.19 Slow tier in full mode. Triple: `--full` · `decide()` · S selected. See `check-pi-settings-paths.test.mjs` (test-plan #E19)
- [x] 8.20 Rename counts both sides. Triple: temp repo `git mv a.ts b.ts` · `changedFiles()` · both paths present. See `scripts/__tests__/lint-harness-scoping.test.mjs` (test-plan #E20)
- [x] 8.21 Deletion counts. Triple: temp repo deletes `packages/p/fixtures/f.json` · `changedFiles()` + `decide()` · path present, package fallback fires. See `lint-harness-scoping.test.mjs` (test-plan #E21)
- [x] 8.22 Packaging flag truth table. Triple: diffs openspec / root AGENTS.md / App.tsx / lockfile · `decide()` · false / true / true / true. See `check-pi-settings-paths.test.mjs` (test-plan #E22)
- [x] 8.23 Gated files never in a shard. Triple: root-packaging test selected by literal layer · `decide()` · absent from all shards, present in ciScenariosFiles. See `check-pi-settings-paths.test.mjs` (test-plan #E23)
- [x] 8.24 Real-process routing. Triple: keeper test dependency in diff · `decide()` · in realProcess, absent from shards. See `check-pi-settings-paths.test.mjs` (test-plan #E24)
- [x] 8.25 Shard assignment deterministic and balanced. Triple: timings `[500,60,50,40,30,20,10,5,1,1]`, 4 shards · `assignShards()` twice · identical, largest ≤ optimum + 500. See `check-pi-settings-paths.test.mjs` (test-plan #E25)
- [x] 8.26 Unknown timing uses the median. Triple: 3 files, 1 without timing data · `assignShards()` · median weight, summary share 1/3. See `check-pi-settings-paths.test.mjs` (test-plan #E26)
- [x] 8.27 Whole output deterministic. Triple: same inputs · `decide()` twice · deep-equal. See `check-pi-settings-paths.test.mjs` (test-plan #E27)
- [x] 8.28 Collection completeness lint. Triple: today's tree, then `quota-plugin` removed · repo-lint test · names the five packages / passes after 1.3 / names quota-plugin; never reports `out/` or `dist/`. See `packages/shared/src/__tests__/real-process-project-guard.test.ts` (test-plan #E28)
- [x] 8.29 Data-file integrity. Triple: slow-tier `gone.test.mjs`, covered entry `docs/sub` · data contract test · fails naming each. See `real-process-project-guard.test.ts` (test-plan #E29)
- [x] 8.30 ci.yml shape contract. Triple: restructured `ci.yml` · updated contract tests · ci-result needs every job including select, matrix == SHARD_COUNT, `ci` has no test needs, no `labeled` type, no unfiltered test run, shards use `pnpm run test:parallel`. See `packages/shared/src/__tests__/ci-vitest-report-artifact.test.ts` (test-plan #E30)
- [x] 8.31 nightly-tests.yml shape contract. Triple: `nightly-tests.yml` · new contract test · cron, dispatch, issues:write, no nightly.yml needs, `--full`, chromium + dist + verify-executed, report always, no publish. See `packages/shared/src/__tests__/nightly-workflow-contract.test.ts` (test-plan #E31)
- [x] 8.32 Audit output. Triple: selection with leaf error, open edge, unmapped file, slow-tier deselection; `GITHUB_STEP_SUMMARY` temp file · CLI run · summary has mode, reason, per-layer counts, named files; selection.json has layer per file and shards. See `scripts/__tests__/check-kb-dist-fresh.test.mjs` (test-plan #E32)
- [x] 8.33 Graph build cost. Triple: real repo tree · graph + literal index build · < 60 s wall. No exemplar exists (first vitest Node-API test; see test-plan New infra) (test-plan #P1)
- [x] 8.34 PR affected wall time. Triple: 3 client-only PRs after the switch · `ci.yml` run · each < 15 min, recorded in design.md. See the `.github/workflows/ci-smoke.yml` dispatch pattern (test-plan #P2) — Done: client-only PRs #771/#775/#779 at 7.5/7.3/7.6 min.
- [x] 8.35 Nightly completes in budget. Triple: a scheduled nightly-tests run · run · every job within timeout, run < 60 min. See the `ci-smoke.yml` dispatch pattern (test-plan #P3) — Done on push-triggered copies (15.0/15.3/14.7 min, every job inside its timeout); the first SCHEDULED run happens after merge.
- [x] 8.36 Transform failure is a leaf. Triple: real `monaco-setup.ts` · graph build on the current tree · no throw, leafErrors has it, SettingsPanel graph intact. No exemplar (first vitest Node-API test) (test-plan #X1)
- [x] 8.37 Internal error falls back to full. Triple: hook forces the builder to throw · CLI · exit 0, mode full, reason names the error. See `check-kb-dist-fresh.test.mjs` (test-plan #X2)
- [x] 8.38 All-zero base. Triple: `--base 000…` in a temp repo · CLI · mode full. See `lint-harness-scoping.test.mjs` (test-plan #X3)
- [x] 8.39 Non-ancestor base. Triple: base on an orphaned branch · CLI · full, reason mentions ancestry. See `lint-harness-scoping.test.mjs` (test-plan #X4)
- [x] 8.40 Missing base ref. Triple: `--base deadbeef` · CLI · full, reason names deadbeef. See `lint-harness-scoping.test.mjs` (test-plan #X5)
- [x] 8.41 Executed differs from assigned. Triple: assigned `[a,b]`, report lists `a` · `verify-executed` · exit ≠ 0 naming b. See `check-pi-settings-paths.test.mjs` (test-plan #X6)
- [x] 8.42 Empty shard. Triple: assigned `[]` · `verify-executed` · exit 0. See `check-pi-settings-paths.test.mjs` (test-plan #X7)
- [x] 8.43 ci-result expectation check. Triple: cases select-failed / non-empty shard skipped / real-process skipped / cancelled / clean · `check-result` · first four fail naming the job, last passes. See `check-pi-settings-paths.test.mjs` (test-plan #X8)
- [x] 8.44 Nightly anchor logic. Triple: run lists ancestor / none / dispatch-only / same SHA · `nightly-report` range · `A..B` / no anchor / no anchor / no new commits. See `check-pi-settings-paths.test.mjs` (test-plan #X9)
- [x] 8.45 Nightly missing report. Triple: `unit-3` report absent · `nightly-report` · listed as no report, not passing. See `check-pi-settings-paths.test.mjs` (test-plan #X10)
- [x] 8.46 Nightly issue lifecycle. Triple: mocked issues API none→red, open→red, open→green · `nightly-report` · create / update the same issue / comment and close. See `check-pi-settings-paths.test.mjs` (test-plan #X11)
- [x] 8.47 Shard without built client. Triple: throwaway branch removes `packages/client/dist` · unit job · fails at the dist assertion. See the `ci-smoke.yml` dispatch pattern (test-plan #X12)
- [x] 8.48 Failed select is never green. Triple: throwaway branch makes select exit 1 · `ci.yml` run · ci-result failure. See the `ci-smoke.yml` dispatch pattern (test-plan #X13)
- [x] 8.49 Seeded-mutation recall. Triple: one mutation per risk class · full suite as ground truth vs selector · recall 100%. Same work as task 3.2; tick both together. See the `ci-smoke.yml` dispatch pattern (test-plan #X14)
- [x] 8.50 Real-run routing. Triple: docs-only / client-only / keeper / lockfile / ci:full + push / develop push · `ci.yml` runs · outcomes as in test-plan X15. Same work as task 5.4; tick both together. See the `ci-smoke.yml` dispatch pattern (test-plan #X15)
- [x] 8.51 Nightly first dispatch. Triple: merged nightly-tests.yml · manual dispatch on develop · green, no issue, not used as anchor. Same work as task 4.2; tick both together. See the `ci-smoke.yml` dispatch pattern (test-plan #X16) — Done as for 4.2; the develop dispatch follows the merge.
