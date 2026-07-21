# Tasks — Tail-First Session Loading

## 1. Protocol (shared)

- [x] 1.1 Add `kind?: "tail" | "older" | "delta"` and `hasOlder?: boolean` to `event_replay` in `packages/shared/src/browser-protocol.ts`; add `load_older { sessionId, beforeSeq, limit? }` to `BrowserToServerMessage`.
- [x] 1.2 Unit test: protocol type round-trips (compile-level + any existing message-validation tests updated).

## 2. Server — window selection

- [x] 2.1 Implement shared `selectWindow(events, beforeSeq | undefined, budget)` helper (tail when `beforeSeq` undefined, older page otherwise): budget `TAIL_WINDOW_EVENTS = 200`, safe-cut backward extension (no open message/tool span at window start), hard cap `2 × budget`. Place beside `subscription-handler.ts`.
- [x] 2.2 Unit tests for `selectWindow`: small session (all events, `hasOlder: false`), snap-to-safe-cut, hard-cap unsafe cut, older page ending at `beforeSeq - 1`, page reaching seq 1 (`hasOlder: false`).

## 3. Server — tail-first subscribe + load_older

- [x] 3.1 Rework `handleSubscribe` warm path (`lastSeq: 0`): send `selectWindow` tail as `kind: "tail"` batches with `hasOlder`; keep `markReplaying`/`clearReplaying` around the window only. Delta path (`lastSeq > 0`) sends `kind: "delta"`, unchanged semantics. Stale-`lastSeq` path sends `session_state_reset` + tail window (not full replay from 1).
- [x] 3.2 Add `load_older` handler: reply single `event_replay { kind: "older", events, hasOlder, isLast: true }` from `selectWindow(events, beforeSeq)`; NO `markReplaying`; unavailable session → empty `kind: "older"` with `hasOlder: false`.
- [x] 3.3 Route `load_older` in `browser-gateway.ts` message switch.
- [x] 3.4 Update `subscription-handler.test.ts`: tail-window subscribe, suppression scoped to window, catch-up after window, `load_older` paging, stale-lastSeq tail reply, live events flow during older delivery.

## 4. Server — cold load delivery

- [x] 4.1 Cold-load path: on worker resolve, compute tail from converted list and send to waiting subscribers immediately (`kind: "tail"`); insert full list into `eventStore` in yielding chunks (setImmediate between bounded slices); keep `extractStatsFromEvents` over the FULL list + `session_updated` broadcast.
- [x] 4.2 Gate `load_older` on the in-flight fill promise (answer after fill completes).
- [x] 4.3 Tests: cold subscribe of a large synthetic session gets tail before full insert completes; `load_older` during fill waits and answers correctly; heartbeat behavior unchanged.

## 5. Client — kind-driven fold + refold

- [x] 5.1 `useMessageHandler` `event_replay` arm: switch on `msg.kind` — `tail` resets once per window (first batch) + rebuilds `maxSeq`; `delta` appends; `older` prepends to raw buffer + full refold from `createInitialState()` + plugin-store clear/republish; legacy (no `kind`) keeps `firstSeq` heuristic. `older` MUST NOT touch `maxSeqMapRef` and MUST NOT set the loading flag.
- [x] 5.2 Promote the raw per-session buffer to authoritative fold input: extend `replayPersister` (or a sibling buffer owner) with prepend + dedup-by-seq + full-buffer read; persist only the tail segment (seed boundary; `older` events excluded from persistence).
- [x] 5.3 Verify `reduceEvent` tolerance for orphan `message_update`/`message_end`/`tool_execution_end` at an unsafe cut; add a guard in the fold entry point (NOT in `reduceEvent` core) only if missing. Unit tests with synthetic mid-span cuts.
- [x] 5.4 Track per-session `hasOlder` + oldest-loaded-seq in client state for the scroll trigger.
- [x] 5.5 Update `useSessionState.ts` pure fold helpers + tests for the `kind` contract (tail resets once, delta appends, older refolds, empty preserves).

## 6. Client — scroll-up pagination UI

- [x] 6.1 ChatView: fire `onLoadOlder` when first visible virtual row index < threshold AND `hasOlder` AND not in flight (single-flight per session); render slim "loading older…" top row while pending.
- [x] 6.2 Anchor preservation on prepend: record first visible row key + offset before apply; after refold render, relocate via `virtualRowKey` and restore offset (TanStack `scrollToIndex`/`scrollToOffset`).
- [x] 6.3 Component tests: trigger threshold, single-flight, end-of-history removes affordance, loading row renders/clears.

## 7. Replay cache interplay

- [x] 7.1 `kind: "tail"` → `replayPersister.seed`; `kind: "delta"`/live → `record`; `kind: "older"` → not persisted. Rehydrate path unchanged (subscribe `lastSeq = persistedMaxSeq`); reconcile provisional state on `kind` metadata instead of `firstSeq <= maxSeq`.
- [x] 7.2 Update replay-cache/persist tests for the seed-boundary rule.

## 8. Verification

- [x] 8.1 Unit suite green for all tail-first files: `select-window` (10), `subscription-handler` tail/older/validation (33), `useSessionState`/`useMessageHandler.replay-reset`/`event-reducer-tail-window`/`replay-persist`/`ChatView.history-pagination`, `browser-protocol-types` (15). Full-suite pre-existing failures (bundled-node floor, git-worktree, platform-branch lints, ModelSelector/StatusBar, docker compose) belong to concurrent unrelated worktree work, not this change.
- [ ] 8.2 Playwright E2E (docker harness): open a large seeded session → recent messages render without full history; scroll-up loads older page with stable anchor; send prompt while a cold load is in flight → stream starts after tail (not after full history).
- [ ] 8.3 performance-optimization checkpoint: measure on a quikdive-scale JSONL (>15 MB): time-to-tail-render before/after, prompt-send-to-first-stream-token during load before/after, parse-vs-delivery split recorded (informs deferred reverse-parse decision).
- [x] 8.4 doubt-driven-review checkpoint on the `kind`-metadata reset contract + suppression narrowing. Audit surfaced + fixed: (a) cold-fill promise now registered BEFORE the tail-send loop (load_older during delivery awaits fill, no false end-of-history); (b) `handleLoadOlder` validates `beforeSeq` (finite, > 1) and clamps `limit` to 2× budget (DoS guard); (c) `selectWindow` `hasOlder` is gap-aware (derived from oldest window seq > 1, not slice offset) so a trimmed/gapped buffer can't advertise infinite older pages; (d) client forces `hasOlder=false` on an empty `older` response (livelock guard). Multi-batch tail reset switched from seq-heuristic to explicit `tailReplayInProgress` window lifecycle.
