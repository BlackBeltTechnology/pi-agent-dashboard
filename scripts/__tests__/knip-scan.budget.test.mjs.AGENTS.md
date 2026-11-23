# __tests__/knip-scan.budget.test.mjs — index

Budget-lane file (`*.budget.test.*`, test-plan #P4/#E31): times its own `npx knip --reporter json --no-progress` scan in `beforeAll` (as `knip-scan.test.mjs` does) and asserts #P1, scan wall-clock < 30 s (45 s on CI). No env gate and no `RUN_CI_SCENARIOS` read: `BUDGET_TEST_EXCLUDE` in `scripts/vitest.config.ts` keeps it out of blocking runs; the nightly `budget` job sets `RUN_BUDGET_TESTS=1`. Split from `knip-scan.test.mjs`, whose live-scan assertions stay blocking. See change: stabilize-blocking-test-lanes.
