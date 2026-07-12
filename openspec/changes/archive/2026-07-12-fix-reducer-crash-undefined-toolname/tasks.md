# Tasks

## 1. Reproduce & lock the failing behaviour (TDD)

- [x] 1.1 Add a reducer unit test: `reduceEvent(createInitialState(), tool_execution_start
      with data.toolName = undefined)` — assert it throws today (red), documenting the
      crash. → verify: test fails on current `event-reducer.ts`.
- [x] 1.2 Add a rehydrate unit test: `rehydrateSession` over a cache payload containing
      one undefined-`toolName` event — assert it throws today (red). → verify: test fails.

## 2. Reducer data-tolerance (primary fix)

- [x] 2.1 In `packages/client/src/lib/event-reducer.ts` `tool_execution_start` handler,
      coalesce `toolName` before use: store `toolName: toolName ?? "unknown"` and
      `currentTool`, and compute `const toolLower = (toolName ?? "").toLowerCase()`.
      → verify: test 1.1 flips to green; Write/Edit heuristic still fires for real names.
- [x] 2.2 Audit sibling `toolName`-reading paths in the reducer + `event-status-extraction`
      (update/end handlers) for the same unguarded string op; apply the same coalesce.
      → verify: `grep -n "toolName" event-reducer.ts` — no unguarded `.toLowerCase()` /
      string op on a possibly-undefined `toolName`.
- [x] 2.3 Add the "valid toolName unaffected" + "non-string toolName coalesced" reducer
      tests from the spec. → verify: all reducer tests green.

## 3. Rehydrate fault-isolation (defense-in-depth)

- [x] 3.1 In `packages/client/src/lib/rehydrate-session.ts`, wrap the per-entry
      re-reduce in try/catch; on throw → discard the session's cache entry
      (`cache.delete(sessionId)` or equivalent), log once, return `null` (cache miss).
      → verify: test 1.2 flips to green; healthy-entry test still delta-rehydrates.
- [x] 3.2 Confirm the App caller treats the `null` return as a cache miss and subscribes
      with `lastSeq: 0` (full replay). → verify: read `App.tsx` rehydrate call site; no
      change needed if the miss path already does this — assert with a test or note.

## 4. Regression + guardrail

- [x] 4.1 Full reducer + rehydrate test suites green. → verify: `npm test 2>&1 | tee
      /tmp/pi-test.log; grep -nE 'FAIL|✗' /tmp/pi-test.log` returns nothing.
- [x] 4.2 Type-check clean. → verify: `npm run quality:changed`.

## 5. Manual verification (QA — automated via Playwright e2e)

- [x] 5.1 With a poisoned IndexedDB cache present, cold-reload → the chat renders, no
      black screen, no uncaught `toLowerCase` error in console. → automated:
      `tests/e2e/reducer-poisoned-cache-heal.spec.ts` test 1 poisons the live
      `pi-dashboard-replay-cache` with an absent-`toolName` `tool_execution_start`,
      reloads, asserts `header-app-bar` still mounts + transcript paints + zero
      `/toLowerCase/` pageerror. Passed `PW_CHANNEL=chrome`.
- [x] 5.2 Clear `pi-dashboard-replay-cache` and reload → session still loads via full
      replay, identical result (no regression). → automated: same spec test 2 clears the
      `sessions` store, reloads, asserts the post-reload subscribe carries `lastSeq: 0`
      (full replay) + transcript repaints. Passed `PW_CHANNEL=chrome`.
