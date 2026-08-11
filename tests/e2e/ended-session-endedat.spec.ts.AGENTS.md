# ended-session-endedat.spec.ts — index

L3 for the evidence-based `endedAt` invariant. Covers test-plan #F1, #F2.

Plants historical transcripts INSIDE the harness via `docker exec`. Container id
resolved from `.pi-test-harness.json`'s compose project label, cached, every
`docker` call bounded by a timeout. Port never hardcoded.

Filename shape is load-bearing:
- name WITHOUT the `<timestamp>_<uuid>` prefix → scanner-invisible,
  `session-bootstrap`-visible. This is how a record reaches the bootstrap restore
  branch on a real boot.
- name WITH that prefix → rebuilt by `session-scanner` on every boot; only these
  persist into stored per-directory order (`reconcileSessionOrder` prunes ids the
  manager cannot produce).

`F1` — bootstrap-restored record anchors at transcript mtime (~30d), not
`startedAt` (~200d) and not reconstruction time.

`F2` — arms `completedFirst` (the gate on `moveToFront` + the
`sessions_reordered` broadcast), plants two scanner-visible records, boots twice,
asserts the WHOLE stored order array is unchanged and zero reorder frames arrive.
Restores the prior `completedFirst` in `finally`. Calls `ensurePinned()` itself so
it does not depend on F1.

LIMITATION: F2 is an end-to-end stored-order guard, NOT the proof of D1a. The boot
restore loop runs at `server.ts:364`, before `sessionManager.onChange` is assigned
at `:391` and before the WS server accepts connections, and `moveToFront` is
idempotent for an id already at the front. D1a's guarantee (`restore()` emits no
`onChange`) is proven fails-on-revert at L1 —
`packages/server/src/__tests__/ended-session-endedat.test.ts` → E12b.

See change: fix-ended-session-missing-endedat.
