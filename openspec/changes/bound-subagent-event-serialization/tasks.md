# Tasks

## 1. Reproduce (systematic-debugging)

- [x] 1.1 Add a failing unit test in `packages/server/src/__tests__/` that
  builds a `DashboardEvent` whose `data` is (a) deeply nested past depth 4 and
  (b) large in aggregate, feeds it through `createMemoryEventStore().insertEvent`
  with a small injected `MAX_EVENT_DATA_SIZE`, then reads it back and asserts the
  stored event's serialized size is ≤ cap. → verify: test FAILS on current code.
- [x] 1.2 Add a test asserting a deep sub-tree (depth > 4) is truncated, NOT
  returned raw. → verify: FAILS on current code.

## 2. Implement the size ceiling (performance-optimization)

- [x] 2.1 Make `MAX_EVENT_DATA_SIZE` a constructor-injectable param of
  `createMemoryEventStore` (mirror `maxStringFieldSize`; `0` = disabled).
  → verify: type-checks; default preserved (20 000).
- [x] 2.2 Add a bounded early-exit size walk (`exceedsSerializedSize(data, cap)`)
  that returns as soon as the running byte total crosses `cap` — never
  `JSON.stringify` the whole object. → verify: unit test with a huge object
  returns `true` without allocating a large string (assert via time/shape, not
  bytes).
- [x] 2.3 In `createTruncator`, after `truncateStrings`, if the size walk reports
  over-cap, replace `event.data` with the bounded placeholder
  (`{ __truncated: true, reason, approxBytes, eventType }`). → verify: 1.1 PASSES.
- [x] 2.4 Close the depth-4 escape in `truncateStrings`: at the depth limit,
  truncate strings and collapse arrays/objects to `"[truncated: deep]"` instead
  of `return obj`. Keep image `data`+`mimeType` preservation. → verify: 1.2
  PASSES; existing image-preservation test still PASSES.

## 3. Guard the broadcast path (regression)

- [x] 3.1 Test that `broadcastEvent` for an over-cap event serializes a bounded
  message (the stored/truncated event, not the raw one). → verify: message size
  bounded; no unbounded `JSON.stringify`.

## 4. Headroom (defensive)

- [x] 4.1 Set/raise `--max-old-space-size` for the server launch and note it in
  `docs/` (delegate the `docs/` write per Documentation Update Protocol). →
  verify: server starts with the flag; `/api/health` reachable.

## 5. Validate

- [x] 5.1 `npm test 2>&1 | tee /tmp/pi-test.log`; `grep -nE 'FAIL|✗' ...` → all
  green, including existing in-memory-event-buffer tests (count trim, chat-head,
  image preservation).
- [x] 5.2 `npm run quality:changed` → clean.
- [ ] 5.3 Manual: run a subagent-heavy turn against a dev server; confirm
  `/api/health` stays up and heap does not spike toward the cap
  (`curl -s localhost:8000/api/health | jq .server.heapUsed`).

## 6. Docs / index

- [x] 6.1 Update `packages/server/src/AGENTS.md` row for `memory-event-store.ts`
  (per-event size ceiling; `See change: bound-subagent-event-serialization`).
