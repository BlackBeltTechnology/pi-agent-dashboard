# __tests__/ci-vitest-report-artifact.test.ts — index

Repo-lint: every vitest job in `ci.yml` uploads its JSON report under its OWN name on EVERY run (`if: always()`): `vitest-report-unit-${{ matrix.shard }}` + `test-results/vitest.json`, `vitest-report-real-process` + `test-results/vitest-real-process.json`, `vitest-report-ci-scenarios`. Backs the CI-only single retry — an unattributable retry is a silent pass. See changes: isolate-real-process-tests, speed-up-ci-affected-tests.
