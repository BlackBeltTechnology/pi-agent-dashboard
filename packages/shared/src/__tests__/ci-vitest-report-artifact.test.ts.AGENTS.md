# __tests__/ci-vitest-report-artifact.test.ts — index

Repo-lint: `ci.yml` uploads the vitest JSON report on EVERY run. Asserts an `actions/upload-artifact` step follows `- run: pnpm test`, carries `if: always()` (the RED run is the one you need it for), and its `path` covers `test-results/vitest*.json`. Backs the CI-only single retry — an unattributable retry is a silent pass. See change: isolate-real-process-tests.
