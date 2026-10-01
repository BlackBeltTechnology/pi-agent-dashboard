# __tests__/nightly-tests-workflow-contract.test.ts — index

Repo-lint for `nightly-tests.yml` (E31): ACTIVE cron + dispatch; `permissions` issues:write, actions:read, contents:read; independent of `nightly.yml`; `select --full`; every unit shard installs chromium, asserts `packages/client/dist/index.html`, runs `test:parallel`, `verify-executed`; per-job `vitest-report-*` uploads `if: always()`; `report` `if: always()` needs all test jobs + runs `nightly-report.mjs`; no publish/tag/release. See change: speed-up-ci-affected-tests.
