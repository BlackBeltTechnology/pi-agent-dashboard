# reap-core.ts — index

Pure, side-effect-free reap logic, unit-tested at L1 in `scripts/__tests__/e2e-reap-core.test.mjs`: `computeDelta`, `settleSessionIds` (adaptive settle — stable 1 s, cap 5 s), `createLatch` (harness declared down only after 3 consecutive probe failures, so a slow harness is not misreported), `checkBudget`, `isLiveSession`, and the constants `RESIDUAL_SESSION_BUDGET=8` / `LATCH_FAILURE_THRESHOLD=3` / `HARNESS_DOWN_MESSAGE`. Budget 8 is a residual tripwire, not peak capacity; its derivation is in the file. See change: fix-e2e-harness-memory-exhaustion.
