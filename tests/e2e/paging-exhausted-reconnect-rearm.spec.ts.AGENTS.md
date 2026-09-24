# paging-exhausted-reconnect-rearm.spec.ts — index

L3 #X4 (close-registry-frame-shed-gaps). Marks `/fixtures/stub-dir` exhausted via the same pin trick, unpins, then closes the live socket through an `addInitScript` socket-tracking wrapper (no reconnect block — the app's own `onclose` backoff must reconnect the SAME instance; a reload would pass vacuously). Asserts `sessions_snapshot.endedTotals[cwd]` byte-identical across the reconnect and `folder-ended-more-<cwd>` available again.

Row summary (formerly inline in `tests/e2e/AGENTS.md`): L3 #X4: reconnect snapshot re-arms a stale exhausted mark.
