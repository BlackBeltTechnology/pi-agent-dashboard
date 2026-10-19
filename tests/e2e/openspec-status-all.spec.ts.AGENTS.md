# openspec-status-all.spec.ts — index

L3 F8 (change: use-openspec-status-all).
Seeds 3 fixture changes `e2e-sa-a|b|c` via `docker exec` per test, removes them in `afterEach` (a committed fixture could reorder the board's first card).
F8: board; corrupt `e2e-sa-b/.openspec.yaml` on disk (`schema: [unclosed`) → watcher-triggered gated re-poll (one `status --all`) → error badge on that card only (others none); restore file → badge clears. No manual refresh in either direction.
Harness container resolved from `.pi-test-harness.json` compose project.
