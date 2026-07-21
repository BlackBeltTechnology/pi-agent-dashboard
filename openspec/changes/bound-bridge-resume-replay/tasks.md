# Tasks — Bound Bridge Resume Replay

## 1. Bound the bridge replay (D1)
- [x] 1.1 Extract a pure tail-window selector for branch entries (mirror `select-window.ts` budget) → verify: unit test picks last-N with safe cut, reports `hasOlder`.
- [x] 1.2 Rewrite `replaySessionEntries()` (`session-sync.ts`) to send the bounded tail in yielding batches (`setImmediate` between chunks) → verify: unit test asserts ≤ N entries sent per resume + yields between batches.
- [x] 1.3 Keep `replay_complete` semantics unchanged → verify: existing bridge session-sync tests pass.

## 2. Stop live re-fanout of replayed history (D2)
- [x] 2.1 On same-id resume, route replayed entries into the event store without per-frame live browser broadcast; deliver tail via the subscribe `event_replay` window → verify: no `event` broadcast fires during replay in a unit test with a subscribed fake browser.
- [x] 2.2 Assert the server→browser WS buffer never exceeds `MAX_WS_BUFFER` for a large-fixture resume → verify: `droppedFramesTotal === 0` after resume in an integration-style test.

## 3. Resilient same-id wipe skip (D3)
- [x] 3.1 Relax `canSkipWipe` in `event-wiring.ts` to tolerate a bounded pi setup-entry count delta when the store is non-empty → verify: unit test — unchanged transcript + 2 extra setup entries skips the wipe.
- [x] 3.2 Correctness guard: delta beyond bound OR empty store still wipes + resets → verify: unit test — new-turns resume wipes and refills.

## 4. Dropped-frame safety net (D4, additive)
- [x] 4.1 Emit a structured dropped-frame notice when a session crosses a small threshold (`browser-gateway.ts`) → verify: unit test emits once past threshold, not per drop.
- [x] 4.2 (Optional) Client reacts with a bounded re-subscribe on the notice → verify: client unit test issues one `subscribe` with tail cursor, no eager full replay.

## 5. Verification on real workload
- [ ] 5.1 Reproduce with a >90 MB fixture session; capture before/after resume time-to-first-render + dropped-frame count → verify: post-change drops = 0, tail visible in < 2s after pi hydration resolves.
- [x] 5.2 Confirm fork path unchanged (regression guard) → verify: fork still mints new sessionId, opens fast, no wipe cascade. (fork-empty-session-preflight, pending-fork-registry, fork-entryid-timing pass; `canSkipEventWipe` returns false for fork's fresh empty store.)

## 6. Gates
- [ ] 6.1 `npm run quality:changed` clean.
- [ ] 6.2 CodeRabbit review on the diff; fix Critical/Warning.
- [x] 6.3 Docs: update `packages/extension/src/AGENTS.md` (session-sync + new select-entry-window rows), server `event-wiring.ts.AGENTS.md` + `browser-gateway.ts.AGENTS.md` sidecars, `packages/shared/src/AGENTS.md` (browser-protocol row), `packages/client/src/hooks/AGENTS.md` (useMessageHandler row) with `See change: bound-bridge-resume-replay`.
