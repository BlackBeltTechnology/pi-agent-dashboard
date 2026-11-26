# ci.md — index

Pull-only condensed map. Source: docs/ci.md.

## Selection

- Decision: `scripts/test-selection/decide.mjs` `decide()`. Layers: graph, open-edge, always, path-literal, package-fallback, trigger-map. `slow-tier` applied last.
- Phase routing: packaging → `ci-scenarios` (`RUN_CI_SCENARIOS=1`); `real-process` files → `real-process`; rest → unit shards (LPT over `timings.json`).
- Full mode: `workflow_dispatch`, `ci:full` label, `--full`, global input change, unmapped file outside `packages/`.
- Fail-safe: selector error → `mode: full`, exit 0. Assigned file missing from vitest JSON → red.

## Budget lane

- `*.budget.test.*` → `BUDGET_TEST_EXCLUDE` (`vitest.workers.ts`) unless `RUN_BUDGET_TESTS=1`.
- Only `npm run test:budget` sets the variable.
- Selector: budget files out of unit, real-process, ci-scenarios.
- `ci` job, blocking: `node scripts/check-budget-lane.mjs`.
- `ci` job, warn-only: `node scripts/check-budget-assertions.mjs --warn` (exit 0; annotations + job summary).
- Nightly `budget` job: `ubuntu-latest`, serial, `BLENDER_WASM_E2E=1`, strict `verify-executed.mjs`.
- `nightly-tests.yml` has no `concurrency` group: a queued run would cancel a pending one.

## Nightly rerun-once

- Attempt 1 red + deadline met → issue deferred; `nightly-attempt-1` artifact.
- `nightly-tests-rerun.yml`: `workflow_run`, `actions: write` only, `gh run rerun --failed` once.
- Attempt 2 reports. Tests and jobs that passed on rerun → "Passed on rerun (flaky)".
- `nightly-tests-watchdog.yml`: cron `47 7 * * *`; opens issue if latest scheduled run not green and unnamed.
- Timing: D 04:05 UTC (`DEFER_DEADLINE_UTC_MINUTE` 245); E 05:35 UTC worst case; W 07:47 UTC.

## Reporter flags (`scripts/test-selection/nightly-report.mjs`)

- `--reports <dir> --expected <k,…>`: report mode.
- `--defer-first-attempt`: attempt-aware; writes `attempt-1.json`.
- `--previous <dir>`: attempt ≥ 2 reads record.
- `--watchdog`, `--dry-run`: watchdog mode, no issue write on dry run.

## Pointers

- Full reference: `docs/ci.md` (sections: Budget lane, Nightly rerun-once).
