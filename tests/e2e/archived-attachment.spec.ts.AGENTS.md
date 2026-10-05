# archived-attachment.spec.ts — index

L3 F8/F11 (change: resolve-archived-attached-proposal).
Seeds fixture change `e2e-archive-flip` via `docker exec` per test, removes it in `afterEach` (a committed fixture could reorder the board's first card).
F8: attach via UI, `mv` change into `archive/<date>-e2e-archive-flip`, card converges to `Archived <date>` with no reload; MutationObserver proves `Not found` never appears.
F11: archived header letter P opens `/openspec/archive/<entry>/proposal`; browser Back restores `/session/<id>`.
Harness container resolved from `.pi-test-harness.json` compose project.
