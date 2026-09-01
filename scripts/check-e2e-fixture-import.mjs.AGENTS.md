# check-e2e-fixture-import.mjs — index

Guard: every `tests/e2e/*.spec.ts` MUST import `test` from `./fixtures.js`, never `@playwright/test` directly — a raw import silently bypasses the session-reap fixture and leaks a session per test. Type-only `@playwright/test` imports stay legal. Exports `analyzeSpecSource`/`analyzeRepository`/`CORRECTION` (rule `e2e-test-import-bypasses-fixture`); CLI exits 1 naming each offending file plus the one-line fix. Wired into `npm run lint:e2e` + CI. Caught two specs `develop` added mid-change. See change: fix-e2e-harness-memory-exhaustion.
