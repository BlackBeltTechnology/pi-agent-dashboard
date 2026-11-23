# __tests__/ci-affected-selection-contract.test.ts — index

Repo-lint for the parallel `ci.yml` (E30): `select` has `fetch-depth: 0`, runs the selector (`--merge-base`, `--full`), uploads `test-selection`, outputs `mode`/`has_real_process`/`ci_scenarios`; `ci-result` needs EVERY job incl. `select`, `if: always()`, runs `check-result.mjs` with `toJSON(needs)`; unit matrix length == `SHARD_COUNT`; `ci` needs no test job and installs no chromium; PR trigger has no `labeled`; PR-scoped concurrency never cancels a push; no unfiltered `pnpm test` / bare `test:ci-scenarios`; shards run `test:parallel`/`test:real-process`/`test:ci-scenarios` with the assigned files + `verify-executed`; `publish.yml` `ci-checks` is the full suite. See change: speed-up-ci-affected-tests.


Budget lane (E11, E108): `ci` job runs "Budget lane check" then "Budget assertion guard (warn-only)" directly after "Fixed-tick wait guard", neither `continue-on-error`; no job sets `continue-on-error`; `ci-result` still needs `blender-real` + `ci-scenarios`; no `budget` job / `test:budget` / `RUN_BUDGET_TESTS` / `budgetFiles` in `ci.yml`. See change: stabilize-blocking-test-lanes.
