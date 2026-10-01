# Test Plan — speed-up-ci-affected-tests

Stage: design   Generated: 2026-09-30

No clarifications. Every Triple can be filled from the spec deltas and design: the shard count (4), the nightly cron, the anchor rules, the layer precedence, and the thresholds (graph build < 60 s, PR affected wall time < 15 min) are all pinned.

Levels:
- **L1** selector logic → `scripts/__tests__/select-affected-tests.test.mjs` (root `scripts` project).
  - Exemplars: pure functions → `scripts/__tests__/check-pi-settings-paths.test.mjs`; temporary git repo fixtures → `scripts/__tests__/lint-harness-scoping.test.mjs`.
- **L1** workflow / repo-lint contracts → `packages/shared/src/__tests__/*.test.ts`.
  - Exemplars: `nightly-workflow-contract.test.ts`, `ci-vitest-report-artifact.test.ts`, `real-process-project-guard.test.ts`.
- **ci** behaviour of the real workflows → throwaway-branch runs driven by `gh workflow run` / PRs.
  - Exemplar: the dispatch-only shim `.github/workflows/ci-smoke.yml`.
- **manual-only** → none. Every observable here is a machine-checkable fact.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Global inputs force full | EP | L1 | automated | diff `["pnpm-lock.yaml"]` | `decide()` | `mode === "full"`, reason contains `pnpm-lock.yaml` |
| E2 | Global inputs (setupFiles) | EP | L1 | automated | synthetic project config with `setupFiles: ["p/setup.ts"]`; diff `["p/setup.ts"]` | `decide()` | `mode === "full"` |
| E3 | Timing data not global | EP | L1 | automated | diff `["scripts/test-selection/timings.json"]` only | `decide()` | `mode === "affected"` |
| E4 | Graph hit (direct) | EP | L1 | automated | graph `{T1:[a.ts], T2:[b.ts]}`; diff `[a.ts]` | `decide()` | selected parallel set contains `T1` and not `T2` |
| E5 | Graph hit (cross-package) | EP | L1 | automated | graph `{clientT:[packages/client/x.tsx, packages/shared/src/y.ts]}`; diff `[packages/shared/src/y.ts]` | `decide()` | `clientT` selected, layer `graph` |
| E6 | Test file itself changed | EP | L1 | automated | diff `[T2]`, and `T2`'s deps are unchanged | `decide()` | `T2` selected |
| E7 | Always-run on OpenSpec-only diff | decision-table | L1 | automated | graph has zero-dep `Z1` and dep-bearing `T1`; diff `[openspec/changes/x/proposal.md]` | `decide()` | `mode === "affected"`; `Z1` selected (layer `always`); `T1` not selected; `ciScenarios === false` |
| E8 | Open edge widens to package | EP | L1 | automated | `T1` graph contains `packages/p/src/loader.ts`, marked open; diff `[packages/p/src/other.json]` | `decide()` | `T1` selected, layer `open-edge` |
| E9 | Path-literal cross-package reader | EP | L1 | automated | literal index `{clientT: ["packages/server"]}`; `clientT` graph does not contain the file; diff `[packages/server/src/cli.ts]` | `decide()` | `clientT` selected, layer `path-literal` |
| E10 | Path-literal via segment | BVA | L1 | automated | test source contains `path.join(root, "openspec", "specs")`; diff `[openspec/specs/a/spec.md]` | build literal index + `decide()` | test selected |
| E11 | Package fallback (css) | EP | L1 | automated | diff `[packages/client/src/index.css]`, reached by no graph | `decide()` | every `packages/client/**` test selected; `mode === "affected"` |
| E12 | Package fallback (Markdown) | EP | L1 | automated | diff `[packages/extension/.pi/skills/x/SKILL.md]` | `decide()` | every `packages/extension/**` test selected |
| E13 | Package manifest scoped | EP | L1 | automated | diff `[packages/roles-plugin/package.json]` | `decide()` | `mode === "affected"`; roles-plugin tests plus tests whose graph enters roles-plugin are selected; `ciScenarios === true` |
| E14 | Unknown outside-package file | EP | L1 | automated | diff `[some-root-data.json]`, in no graph / trigger map / covered list | `decide()` | `mode === "full"`, reason names the file |
| E15 | Trigger-map hit | EP | L1 | automated | trigger map `{"scripts/z-layer-baseline.json": ["scripts/__tests__/z-layer*.test.mjs"]}`; diff that file | `decide()` | the matching tests are selected; `mode === "affected"` |
| E16 | Covered-elsewhere contributes nothing | EP | L1 | automated | diff `[docs/faq.md]`, `docs` in the covered list | `decide()` | `mode === "affected"`; selection is exactly the always-run set plus the path-literal readers of `docs` |
| E17 | Slow tier deselects (applied last) | decision-table | L1 | automated | `S` in the slow tier; `S` reached by the graph, named by a literal, and matched by a trigger; diff hits all three | `decide()` | `S` not selected; `S` listed under `slowTierDeselected` |
| E18 | Slow tier re-included on edit | decision-table | L1 | automated | diff `[S]` | `decide()` | `S` selected |
| E19 | Slow tier in full mode | decision-table | L1 | automated | `--full` | `decide()` | `S` selected |
| E20 | Rename counts both sides | EP | L1 | automated | temporary git repo: `git mv packages/p/src/a.ts packages/p/src/b.ts`, commit | `changedFiles(base, head)` | result contains both `a.ts` and `b.ts` paths |
| E21 | Deletion counts | EP | L1 | automated | temporary git repo: delete `packages/p/fixtures/f.json`, commit | `changedFiles()` + `decide()` | the path is present; the packages/p fallback fires |
| E22 | Packaging flag truth table | decision-table | L1 | automated | diffs: `[openspec/x.md]`, `[AGENTS.md]`, `[packages/client/src/App.tsx]`, `[pnpm-lock.yaml]` | `decide()` | `ciScenarios`: false, true, true, true |
| E23 | Gated files never in a shard | EP | L1 | automated | `root-packaging.test.mjs` (reads `RUN_CI_SCENARIOS`) selected by the path-literal layer | `decide()` | file absent from every `shards[i]`, present in `ciScenariosFiles` |
| E24 | Real-process routing | EP | L1 | automated | `keeper.test.ts` collected only by the real-process config; diff hits its dependency | `decide()` | file in `realProcess`, absent from every shard |
| E25 | Shard assignment deterministic + balanced | BVA | L1 | automated | 10 files with timings `[500,60,50,40,30,20,10,5,1,1]`, 4 shards | `assignShards()` twice | identical output both times; largest shard ≤ optimum + 500 |
| E26 | Unknown-timing median | EP | L1 | automated | 3 files, 1 without timing data | `assignShards()` | the unknown file is weighted at the median of the known timings; summary share = 1/3 |
| E27 | Deterministic whole output | EP | L1 | automated | same graph + diff + data | `decide()` twice | deep-equal outputs |
| E28 | Collection completeness | EP | L1 | automated | today's tree; then the same with `quota-plugin` removed from `projects` | repo-lint test | fails naming the five packages today; passes after task 1.3; fails naming `quota-plugin` when it is removed; no `out/`/`dist/` path is ever reported |
| E29 | Data-file integrity | EP | L1 | automated | slow-tier entry `scripts/__tests__/gone.test.mjs`; a covered entry `docs/sub` (sub-path) | data contract test | fails naming each bad entry |
| E30 | ci.yml shape contract | EP | L1 | automated | the restructured `ci.yml` | updated contract tests (`ci-vitest-report-artifact` etc.) | `ci-result.needs` ⊇ every job, including `select`; matrix length == `SHARD_COUNT`; `ci` has no `needs` on test jobs; `pull_request` has no `types` containing `labeled`; no unfiltered `pnpm test` / `test:ci-scenarios`; shards invoke `pnpm run test:parallel` |
| E32 | Every selection is auditable | EP | L1 | automated | an affected selection with 1 leaf error, 1 open edge, 1 unmapped-then-full file, 1 slow-tier deselection; `GITHUB_STEP_SUMMARY` set to a temp file | CLI run | summary file contains mode, reason, one count per layer (global, graph, open edge, always-run, path literal, package fallback, trigger map, slow tier) and names each listed file; `selection.json` lists every selected file with its layer and the shard assignments |
| E31 | nightly-tests.yml shape contract | EP | L1 | automated | `nightly-tests.yml` | new contract test | uncommented `cron`; `workflow_dispatch`; `issues: write`; no `needs` on `nightly.yml`; `--full`; chromium + dist assertion + `verify-executed` in every shard; `report` `if: always()`; no publish/tag/release |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Graph build cost | threshold | L1 | automated | the real repo tree (~2,100 test files, root + real-process configs) | whole graph plus literal index built in < 60 s wall | a single run in the integration test |
| P2 | PR affected wall time | threshold | ci | automated | 3 real client-only PRs after the switch | end-to-end `ci.yml` wall time < 15 min on each | per run; recorded in `design.md` |
| P3 | Nightly full suite completes | threshold | ci | automated | a scheduled full nightly | every job finishes inside its `timeout-minutes`; the run concludes within 60 min | one scheduled run |

### Frontend-quirk

_None. This change has no rendered UI._

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Transform failure is a leaf | fault-injection (abort) | L1 | automated | the real `monaco-setup.ts` fails to resolve `monaco-editor` | graph build on the current tree | no throw; `leafErrors` contains `monaco-setup.ts`; `SettingsPanel.test.tsx` graph contains `SettingsPanel.tsx` |
| X2 | Selector internal error → full | fault-injection (abort) | L1 | automated | test hook forces the graph builder to throw | CLI run | exit code 0; `selection.json` has `mode: "full"`; reason names the error |
| X3 | All-zero push base | fault-injection | L1 | automated | `--base 0000000000000000000000000000000000000000` | CLI run in a temporary git repo | `mode: "full"` |
| X4 | Force-push base (non-ancestor) | fault-injection | L1 | automated | temporary repo: base = commit on an orphaned branch | CLI run | `mode: "full"`, reason mentions ancestry |
| X5 | Missing base ref | fault-injection | L1 | automated | `--base deadbeef` | CLI run | `mode: "full"`, reason names `deadbeef` |
| X6 | Executed ≠ assigned | fault-injection | L1 | automated | assigned `[a,b]`; report `testResults` lists only `a` | `verify-executed` | exit ≠ 0; output names `b` |
| X7 | Empty shard | EP | L1 | automated | assigned `[]` | `verify-executed` | exit 0 |
| X8 | `ci-result` expectation check | decision-table | L1 | automated | cases: (a) `select` failure; (b) non-empty shard skipped; (c) real-process expected but skipped; (d) job cancelled; (e) all expected succeeded, unexpected skipped | `check-result` | (a)–(d) exit ≠ 0 naming the job; (e) exit 0 |
| X9 | Nightly anchor logic | decision-table | L1 | automated | run lists: (a) green schedule run at `A`, ancestor of `B`; (b) no green schedule run; (c) green dispatch run on a feature branch only; (d) green schedule run at `B` | `nightly-report` range | (a) `A..B`; (b) "no green anchor"; (c) not used as the anchor, so (b) wording; (d) "no new commits" wording |
| X10 | Nightly missing report | fault-injection | L1 | automated | expected jobs `unit-1..4` + `real-process`; `unit-3` report absent | `nightly-report` | issue body lists `unit-3` as "no report", never as passing |
| X11 | Nightly issue lifecycle | state-transition | L1 | automated | mocked issues API: none open → red; open → red; open → green | `nightly-report` | create; update the same issue number with no second issue; comment naming the green SHA and close |
| X12 | Shard without built client | fault-injection | ci | automated | throwaway branch whose shard step removes `packages/client/dist` before vitest | `unit` job | job fails at the dist assertion step |
| X13 | Selector job failure is never green | fault-injection | ci | automated | throwaway branch that makes `select` exit 1 | `ci.yml` run | `ci-result` concludes `failure` |
| X14 | Seeded-mutation recall | fault-injection | ci | automated | one breaking mutation per risk class (server module, shared runtime, client component, `index.css`, package JSON fixture, flows-plugin bridge, conventions-read `openspec/` file, cross-package literal read, root `AGENTS.md`) | full suite per mutation (ground truth) vs selector | every ground-truth failing file is in the selection (recall = 100%) |
| X15 | Real-run routing | decision-table | ci | automated | PRs: docs-only; client-only; keeper-module; `pnpm-lock.yaml`; a `ci:full`-labelled PR plus a push; a `develop` push | `ci.yml` runs | respectively: `ci` + always-run shard with `ci-scenarios` skipped; `affected` with `ci-scenarios` running; the real-process job runs `keeper.test.ts`; `full`; `full` including the slow tier; `affected` (not a depth-induced `full`) |
| X16 | Nightly first dispatch | state-transition | ci | automated | `nightly-tests.yml` merged | manual `workflow_dispatch` on `develop` | run green; no `nightly-tests` issue created; the dispatch is not used as an anchor by the next scheduled run |

---

## Coverage summary

- Requirements covered: 22/22
  - `affected-test-selection`: 16
  - `ci-cd-pipeline`: 3 (CI workflow, vitest report, release gate; the release gate via E30's publish-contract assertion)
  - `nightly-verification`: 2
  - `parallel-test-execution`: real-process phase, covered by E24 + X15
- Scenarios by class: edge 32 · perf 3 · frontend 0 · error 16
- Scenarios by level: L1 44 · ci 7 · L2 0 · L3 0
- Scenarios by disposition: automated 51 · manual-only 0

## New infra needed

- No existing test uses the vitest Node API (`createVitest`). The graph-builder integration test (X1, P1) is the first. It lives in `scripts/__tests__/`, and has no harness exemplar beyond the spike script shape (`/tmp/ci-spike-artifacts/depgraph2.mjs`).
- `ci`-level scenarios run on throwaway branches through `gh workflow run` / PRs. There is no local harness; the observable is the run conclusion and the uploaded artifacts.
