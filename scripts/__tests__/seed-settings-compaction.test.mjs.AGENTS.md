# __tests__/seed-settings-compaction.test.mjs — index

Unit tests for the e2e-only `compaction.keepRecentTokens` seed (change: replay-compaction-boundary): merge decision-table (fresh write, sibling-key preservation, no-clobber, unrelated top-level keys kept) + the file wrapper's corrupt-file / absent-path / idempotent cases.
