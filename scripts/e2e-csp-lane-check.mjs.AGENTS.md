# e2e-csp-lane-check.mjs — index

Zero-skip check for CSP E2E lanes. `<report.json> [--allow a,b] [--require x,y]` (spec basenames). Exit 1: 0 tests, `--require`d spec absent, `stats.unexpected>0`, or a CSP-reason skip (`skip` annotation containing `PI_DASHBOARD_CSP`) outside `--allow`; exit 2 bad usage/report. Walks nested suites. No deps. Used by CI job `e2e-csp-report-lane`. See change: enforce-strict-csp-default (D4).

Tests: `__tests__/e2e-csp-lane-check.test.mjs` (#E6) over a real Playwright JSON fixture `__tests__/fixtures/e2e-csp-lane-report.json` (captured from a throwaway spec): allow-list, unrelated skip, unexpected, 0 tests, `--require`, nested suites.
