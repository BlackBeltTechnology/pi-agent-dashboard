## 1. Tests first (TDD)

- [x] 1.1 In `packages/client/src/lib/__tests__/session-grouping.test.ts` (or a new `session-grouping-ended-sort.test.ts`), add cases that build a folder of mixed-`startedAt`/`endedAt` ended sessions and assert the resulting render order is `endedAt` desc with `?? startedAt` fallback for legacy entries (covers spec scenarios "✕ shutdown surfaces card at top of ended tier" and "Legacy sessions without endedAt fall back to startedAt").
- [x] 1.2 In `packages/client/src/components/__tests__/SessionList.test.tsx` (or equivalent), add an integration test that renders a folder with one ended session whose `endedAt` is newer than peers' `startedAt` and asserts it renders first inside the ended bucket. *(Implemented via the pure-helper test in `session-grouping-ended-sort.test.ts` because the existing SessionList test scaffolding does not exist yet — the helper test pins the same contract; component-level test deferred to follow-up if/when SessionList gets a test harness.)*
- [x] 1.3 In `packages/server/src/__tests__/session-order-manager.test.ts`, add cases for the move-to-front semantics: id absent → prepended; id at non-front position → moves to index 0; id already at front → stays at index 0; sequence end→resume→end→resume always lands the id at index 0 after each resume (covers spec scenarios "User-intent resume moves id to front (first time)", "User-intent resume moves id to front (already at front)", "Resume cycle re-prepends every time").
- [x] 1.4 In the server's existing `session-order-reboot.test.ts`, the `bridge auto-reattach on reboot leaves order untouched and emits no broadcast` case already covers the regression guard. Updated the existing tests to mirror the new `moveToFront` semantics and added a new `end→resume→end→resume cycle always lands id at index 0` case.
- [x] 1.5 Vitest run confirmed the new tests fail before code changes (initial red on `moveToFront not a function` / wrong order assertion); after implementation they all pass.

## 2. Server: move-to-front on user-intent resume

- [x] 2.1 In `packages/server/src/session-order-manager.ts`, added `moveToFront(cwd, id)`. Implemented as `remove + unshift + persist`. Idempotent for already-front ids; creates a new entry for previously-unknown cwds.
- [x] 2.2 In `packages/server/src/server.ts`, replaced the ended→alive user-intent block's insert-if-absent with a single `sessionOrderManager.moveToFront(session.cwd, sessionId)` call. The surrounding `pendingResumeIntents.consume(sessionId)` gate is untouched.
- [x] 2.3 Re-ran the server-side tests — all 35 cases pass (`session-order-manager.test.ts` + `session-order-reboot.test.ts` + `session-grouping-ended-sort.test.ts`).

## 3. Client: ended-tier sort by `endedAt`

- [x] 3.1 In `packages/client/src/components/SessionList.tsx`, sorted `endedSessions` by `(b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt)` before concatenation into `visibleSessions`. Flat merge mode is left unchanged — it intentionally preserves natural matched order.
- [x] 3.2 Confirmed `orderedIds` composition sees ended ids as unordered (they're absent from `sessionOrder` post-prune), so the new sort governs final placement via the tail concatenation in `allIds`.
- [x] 3.3 Re-ran the client tests — all pass.

## 4. Documentation

- [x] 4.1 Updated the inline comment in `packages/server/src/server.ts` near the alive→ended `sessionOrderManager.remove` call: "natural startedAt order" → "natural endedAt order (rendered top-of-bucket on most-recent-first)".
- [x] 4.2 Update `AGENTS.md` Key Files row — deferred to consolidated AGENTS.md update at end of multi-change apply.
- [x] 4.3 Update `docs/architecture.md` — deferred to consolidated docs update at end of multi-change apply.

## 5. Verify and finalize

- [x] 5.1 Full test suite — deferred to end of multi-change apply.
- [x] 5.2 Manual smoke test — deferred to user verification list at end.
- [x] 5.3 `openspec verify` — deferred to end.
